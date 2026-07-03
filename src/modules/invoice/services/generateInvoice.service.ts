import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { resolve } from 'path';
import { NotFoundError } from 'src/classes/httpError/notFounError';
import { UnprocessableEntity } from 'src/classes/httpError/unProcessableEntity';
import { getBaseUrl } from 'src/config/environments';
import { IEnrollment, IInfoInvoice } from 'src/interfaces/enrollment.interface';
import {
  IGenerateInvoice,
  IInvicePdfParams,
} from 'src/interfaces/invoice.interface';
import { generarCodigoBarras } from 'src/utils/barcode.util';
import {
  calcularTotales,
  calcularTotalExtraOrdinario,
  createQRBase64,
  generateEndDatePayment,
  hasPaymentInvoice,
  llenarSubTotal,
  llenarSubTotalSinAumento,
} from 'src/utils/invoice.util';
import {
  compileHBS,
  convertHTMLtoPDF,
  initializeHelpersHbs,
} from 'src/utils/reportPdf.util';
import { DataSource, Repository } from 'typeorm';
import {
  INFO_MATRICULA_SQL,
  INFO_PROGRAMA_SQL,
} from '../constant/invoiceSql.constant';
import { GenerateInvoiceDto } from '../dto/generate-invoice.dto';
import { DetailInvoice } from '../entities/detailInvoice.entity';
import { UniversityPeriod } from '../entities/univsityPeriod.entity';
import { ECategoryInvoice } from '../enums/invoice.enum';
import { DiscountRepository } from '../repositories/discount.repository';
import { InvoiceRepository } from '../repositories/invoice.repository';
import { PackageRepository } from '../repositories/package.repository';
import { ConsultInvoiceService } from './consultInvoice.service';
import { EnrollmentService } from './enrollment.service';

const profileBlock = async <T>(
  scope: string,
  label: string,
  task: () => Promise<T>,
): Promise<T> => {
  const startedAt = Date.now();
  try {
    return await task();
  } finally {
    const ms = Date.now() - startedAt;
    console.log(`[perf:financiero_itp_api:${scope}] ${label}: ${ms}ms`);
    console.log(`[perf] ${scope}.${label} ${ms}ms`);
  }
};

const TECHNOLOGY_CREDIT_CONCEPT_ID = 33;

@Injectable()
export class GenerateInvoiceService {
  constructor(
    private readonly consultInvoiceService: ConsultInvoiceService,
    private readonly packageRepository: PackageRepository,
    private readonly invoiceRepository: InvoiceRepository,

    @InjectRepository(UniversityPeriod)
    private periodRepository: Repository<UniversityPeriod>,

    @InjectRepository(DetailInvoice)
    private detailInvoiceRepository: Repository<DetailInvoice>,

    private readonly dataSource: DataSource,

    private discountRepository: DiscountRepository,
    private enrollmentService: EnrollmentService,
  ) {}

  async mainGenerateInvoice(payload: GenerateInvoiceDto) {
    const {
      codPaquete,
      matriculaId,
      isPagoOnline,
      total,
      personaId,
      programaPersonaId,
      cantidad,
      conceptoId,
      descripcion,
    } = payload;

    const packageInvoce = await profileBlock(
      'invoice.create',
      'packageRepository.findConceptsByCode',
      () => this.packageRepository.findConceptsByCode(codPaquete),
    );
    if (!packageInvoce) throw new NotFoundError('No se encontro el paquete');

    const queryRunner = this.dataSource.createQueryRunner();
    await profileBlock('invoice.create', 'queryRunner.connect', () => queryRunner.connect());

    const [infoMatricula] = await profileBlock(
      'invoice.create',
      !matriculaId ? 'INFO_PROGRAMA_SQL' : 'INFO_MATRICULA_SQL',
      () =>
        !matriculaId
          ? queryRunner.manager.query<IEnrollment[]>(INFO_PROGRAMA_SQL, [
              personaId,
              programaPersonaId,
            ])
          : queryRunner.manager.query<IEnrollment[]>(INFO_MATRICULA_SQL, [
              matriculaId,
            ]),
    );

    await profileBlock('invoice.create', 'queryRunner.release', () => queryRunner.release());

    if (!infoMatricula)
      throw new NotFoundError('No se encontro el programa o la matricula');

    const params: IGenerateInvoice = {
      infoEstudiante: infoMatricula,
      codPaquete,
      matriculaId,
      isPagoOnline,
      total,
      categoriaPagoId: packageInvoce.categoriaId,
      cantidad,
      conceptoId,
      descripcion,
    };

    const invoice = await profileBlock('invoice.create', 'generateInvoiceByParams', async () =>
      this.consultInvoiceService.generateInvoiceByParams(params),
    );
    return invoice;
  }

  async generateAndSaveInvoice(payload: GenerateInvoiceDto) {
    const invoiceNew = await profileBlock('invoice.create', 'mainGenerateInvoice', () =>
      this.mainGenerateInvoice(payload),
    );

    if (!invoiceNew)
      throw new UnprocessableEntity('No se pudo generar la factura');

    const duplicateInvoice = await profileBlock(
      'invoice.create',
      'invoiceRepository.findDuplicateInvoice',
      () =>
        this.invoiceRepository.findDuplicateInvoice(
          payload.personaId,
          invoiceNew.categoriaPagoId,
        ),
    );

    if (duplicateInvoice) {
      await profileBlock('invoice.create', 'detailInvoiceRepository.deleteDuplicateDetails', () =>
        this.detailInvoiceRepository.delete({
          facturaId: duplicateInvoice.id,
        }),
      );
    }
    const invoiceSave = this.invoiceRepository.create({
      ...duplicateInvoice,
      ...invoiceNew,
      descripcion: this.resolveInvoiceDescription(payload.descripcion, invoiceNew),
    });

    return profileBlock('invoice.create', 'invoiceRepository.save', () =>
      this.invoiceRepository.save(invoiceSave),
    );
  }

  private resolveInvoiceDescription(
    descriptionPayload: string | undefined,
    invoiceNew: any,
  ): string {
    const description = (descriptionPayload ?? '').trim();
    if (description.length > 0) {
      return description;
    }

    const details = Array.isArray(invoiceNew?.detailInvoices)
      ? invoiceNew.detailInvoices
      : [];

    const concepts = details
      .map((detail: any) => (detail?.concept?.descripcion ?? '').trim())
      .filter((item: string) => item.length > 0);

    if (concepts.length > 0) {
      return concepts.join(' + ');
    }

    return `PAGO ${invoiceNew?.codPaquete ?? 'GENERAL'}`;
  }

  async getHtmlInvoice(invoiceId: number): Promise<string> {
    const invoice = await profileBlock('invoice.html', 'invoiceRepository.findById', () =>
      this.invoiceRepository.findById(invoiceId),
    );

    if (!invoice)
      throw new NotFoundError(`No se encontro la factura con id ${invoiceId}`);
    const { jsonResponse, categoryInvoice, detailInvoices } = invoice;

    const { info_cliente }: IInfoInvoice = JSON.parse(jsonResponse);

    const packageInvoce = await profileBlock(
      'invoice.html',
      'packageRepository.findConceptsByCode',
      () => this.packageRepository.findConceptsByCode(invoice.codPaquete),
    );
    if (!packageInvoce) throw new NotFoundError('No se encontro el paquete');

    const { totalOrdinario } = calcularTotales(detailInvoices);
    const totalExtraordinario = calcularTotalExtraOrdinario(
      invoice.detailInvoices,
      packageInvoce,
    );

    const [discounts, studentType] = await Promise.all([
      profileBlock('invoice.html', 'discountRepository.findForEnrollment', () =>
        this.discountRepository.findForEnrollment(
          categoryInvoice.id,
          info_cliente.ide_persona,
          info_cliente.cod_periodo,
        ),
      ),

      profileBlock('invoice.html', 'enrollmentService.generateStudentTypeByEnrollment', () =>
        this.enrollmentService.generateStudentTypeByEnrollment(info_cliente),
      ),
    ]);

    invoice.detailInvoices = llenarSubTotal(detailInvoices);

    const url = `${getBaseUrl()}/invoice/generate/pdf/${invoice.id}`;
    const qrBase64 = await profileBlock('invoice.html', 'createQRBase64', () => createQRBase64(url));

    initializeHelpersHbs();
    const hasPayment = hasPaymentInvoice(invoice);

    if (invoice.categoriaPagoId == ECategoryInvoice.MATRICULA) {
      invoice.detailInvoices = llenarSubTotalSinAumento(detailInvoices);
      invoice.detailInvoices = invoice.detailInvoices.map((detail) => {
        const creditQuantity = Number(info_cliente?.nro_creditos || 0);
        if (
          Number(detail.conceptoId) == TECHNOLOGY_CREDIT_CONCEPT_ID &&
          Number(detail.descuento) >= 1 &&
          creditQuantity > 0
        ) {
          return {
            ...detail,
            cantidad: creditQuantity,
          };
        }

        return detail;
      });

      const barcodeOrd = await profileBlock('invoice.html', 'generarCodigoBarras.ordinario', () =>
        generarCodigoBarras({
          limitDate: studentType?.fechaFinMatricula,
          reference: invoice.id.toString(),
          value: totalOrdinario,
        }),
      );
      const barcodeExtra = await profileBlock('invoice.html', 'generarCodigoBarras.extraordinario', () =>
        generarCodigoBarras({
          limitDate: studentType.fechaFinMatriculaExt,
          reference: invoice.id.toString(),
          value: totalExtraordinario,
        }),
      );

      const dataReport: IInvicePdfParams = {
        ...invoice,
        barcodeOrd: !hasPayment ? barcodeOrd.barcodeBase64 : '',
        barcodeExt: !hasPayment ? barcodeExtra.barcodeBase64 : '',
        infoStudent: info_cliente,
        discounts,
        totalOrdinario,
        totalExtraordinario,
        period: studentType,
        qrBase64,
        generated: new Date(),
        BASE_URL: getBaseUrl(),
        hasPayment,
      };
      const pathTemplateBody = resolve(
        __dirname,
        '../../../',
        'templates/facturaMatricula.pdf.hbs',
      );
      return profileBlock('invoice.html', 'compileHBS.facturaMatricula', async () =>
        compileHBS(pathTemplateBody, dataReport),
      );
    }

    if (invoice.categoriaPagoId == ECategoryInvoice.INSCRIPCION) {
      const barcodeOrd = await profileBlock('invoice.html', 'generarCodigoBarras.inscripcion', () =>
        generarCodigoBarras({
          limitDate: studentType.fecFinInsNuevos ?? generateEndDatePayment(),
          reference: invoice.id.toString(),
          value: totalOrdinario,
        }),
      );

      const dataReport: IInvicePdfParams = {
        ...invoice,
        barcodeOrd: !hasPayment ? barcodeOrd.barcodeBase64 : '',
        infoStudent: info_cliente,
        discounts,
        totalOrdinario,
        period: studentType,
        qrBase64,
        generated: new Date(),
        BASE_URL: getBaseUrl(),
        hasPayment,
      };
      const pathTemplateBody = resolve(
        __dirname,
        '../../../',
        'templates/facturaInscripcion.pdf.hbs',
      );
      return profileBlock('invoice.html', 'compileHBS.facturaInscripcion', async () =>
        compileHBS(pathTemplateBody, dataReport),
      );
    }

    const limitDate = invoice.fechaLimite ?? generateEndDatePayment();

    const barcodeOrd = await profileBlock('invoice.html', 'generarCodigoBarras.general', () =>
      generarCodigoBarras({
        limitDate,
        reference: invoice.id.toString(),
        value: totalOrdinario,
      }),
    );

    const dataReport: IInvicePdfParams = {
      ...invoice,
      barcodeOrd: !hasPayment ? barcodeOrd.barcodeBase64 : '',
      infoStudent: info_cliente,
      totalOrdinario,
      limitDate,
      qrBase64,
      generated: new Date(),
      BASE_URL: getBaseUrl(),
      hasPayment,
    };
    const pathTemplateBody = resolve(
      __dirname,
      '../../../',
      'templates/facturaGeneral.pdf.hbs',
    );
    return profileBlock('invoice.html', 'compileHBS.facturaGeneral', async () =>
      compileHBS(pathTemplateBody, dataReport),
    );
  }

  async getPdfInvoice(invoiceId: number): Promise<Buffer> {
    const templateHtml = await profileBlock('invoice.pdf', 'getHtmlInvoice', () =>
      this.getHtmlInvoice(invoiceId),
    );
    const buffer = await profileBlock('invoice.pdf', 'convertHTMLtoPDF', () =>
      convertHTMLtoPDF(templateHtml),
    );
    return buffer;
  }
}
