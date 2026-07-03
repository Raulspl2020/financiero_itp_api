import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isEmpty, isNull } from 'lodash';
import * as moment from 'moment';
import { IGenerateInvoice } from 'src/interfaces/invoice.interface';
import { DataSource, Repository } from 'typeorm';
import { NotFoundError } from '../../../classes/httpError/notFounError';
import { UnprocessableEntity } from '../../../classes/httpError/unProcessableEntity';
import {
  IEnrollment,
  IInfoInvoice,
} from '../../../interfaces/enrollment.interface';
import { createDetailInvoice } from '../../../utils/adapters/invoiceAdapter.util';
import {
  calcularTotales,
  generateCodeInvoice,
  generateEndDatePayment,
  isOnlinePay,
} from '../../../utils/invoice.util';
import { INFO_MATRICULA_SQL } from '../constant/invoiceSql.constant';
import { DetailInvoice } from '../entities/detailInvoice.entity';
import { Invoice } from '../entities/invoice.entity';
import { UniversityPeriod } from '../entities/univsityPeriod.entity';
import {
  ECategoryInvoice,
  EEmailStatus,
  EOnlinePayment,
  EPackageCode,
  EStatusInvoice,
  ESysApoloStatus,
  PACKAGE_TYPE,
} from '../enums/invoice.enum';
import { ConfigRepository } from '../repositories/config.repository';
import { DiscountRepository } from '../repositories/discount.repository';
import { InvoiceRepository } from '../repositories/invoice.repository';
import { PackageRepository } from '../repositories/package.repository';
import { EnrollmentService } from './enrollment.service';

@Injectable()
export class ConsultInvoiceService {
  constructor(
    private readonly invoiceRepository: InvoiceRepository,
    private readonly packageRepository: PackageRepository,

    private configRepository: ConfigRepository,
    private discountRepository: DiscountRepository,

    @InjectRepository(DetailInvoice)
    private detailInvoiceRepository: Repository<DetailInvoice>,

    @InjectRepository(UniversityPeriod)
    private periodRepository: Repository<UniversityPeriod>,

    private enrollmentService: EnrollmentService,

    private readonly dataSource: DataSource,
  ) {}

  async searchInvoiceForPayment(invoiceId: number): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findById(invoiceId);
    if (!invoice) throw new NotFoundError('Factura no encontrada');
    const { detailPayments } = invoice;

    const payments = detailPayments.filter(
      (payment) => payment.estadoPagoId == EStatusInvoice.PAGO_FINALIZADO_OK,
    );

    if (!isEmpty(payments))
      throw new UnprocessableEntity('Factura ya ha sido pagada');

    const { codPaquete, matriculaId, categoriaPagoId, jsonResponse, isOnline } =
      invoice;

    const { info_cliente: infoStudet }: IInfoInvoice = JSON.parse(jsonResponse);
    const { totalExtraordinario: total } = calcularTotales(
      invoice.detailInvoices,
    );

    const params: IGenerateInvoice = {
      infoEstudiante: infoStudet,
      codPaquete,
      matriculaId,
      isPagoOnline: isOnlinePay(isOnline),
      total,
      categoriaPagoId,
    };

    if (categoriaPagoId !== ECategoryInvoice.MATRICULA) {
      invoice.valor = total;
      return invoice;
    }

    const newInvoice = await this.generateInvoiceByParams(params);

    if (total == newInvoice.valor) {
      return newInvoice;
    }

    await this.detailInvoiceRepository.delete({
      facturaId: invoiceId,
    });

    const invoiceSave = this.invoiceRepository.create({
      ...invoice,
      ...newInvoice,
    });

    return this.invoiceRepository.save(invoiceSave);
  }

  generateInvoiceByParams(params: IGenerateInvoice): Promise<Invoice> {
    const { categoriaPagoId } = params;

    if (categoriaPagoId == ECategoryInvoice.MATRICULA) {
      return this.generateInvoiceEnrrolment(params);
    }

    if (categoriaPagoId == ECategoryInvoice.INSCRIPCION) {
      return this.generateInvoiceRegistration(params);
    }

    if (categoriaPagoId == ECategoryInvoice.OTROS) {
      return this.generateInvoiceOther(params);
    }

    return this.generateInvoiceVariousByInvoice(params);
  }

  async generateInvoiceOther(params: IGenerateInvoice): Promise<Invoice> {
    const config = await this.configRepository.getCurrentConfig();
    if (!config) throw new NotFoundError('No se encontro la configuracion');

    const packageInvoce = await this.packageRepository.findConceptsByCode(
      params.codPaquete,
    );
    if (!packageInvoce) throw new NotFoundError('No se encontro el paquete');

    let { packageDetail } = packageInvoce;
    const { categoriaId } = packageInvoce;

    if (params.conceptoId) {
      packageDetail = packageDetail.filter(
        (detail) => Number(detail.conceptoId) === Number(params.conceptoId),
      );
      if (packageDetail.length === 0) {
        throw new NotFoundError('El concepto seleccionado no pertenece al paquete');
      }
    }

    const { infoEstudiante: infoMatricula, total } = params;

    const detailInvoice = this.detailInvoiceRepository.create(
      createDetailInvoice({
        packageDetail,
        total,
      }),
    );

    const infoClient: IInfoInvoice = {
      info_cliente: params.infoEstudiante,
    };

    return this.invoiceRepository.create({
      estadoId: EStatusInvoice.PAGO_INICADO,
      estudianteId: infoMatricula.ide_persona,
      jsonResponse: JSON.stringify(infoClient),
      codigo: generateCodeInvoice(infoMatricula),
      matriculaId: params.matriculaId,
      valor: params.total,
      periodoId: infoMatricula.cod_periodo,
      codPaquete: params.codPaquete,
      isOnline: params.isPagoOnline ? EOnlinePayment.SI : EOnlinePayment.NO,
      categoriaPagoId: categoriaId,
      fechaUpdate: new Date(),
      fechaLimite: generateEndDatePayment(),
      sysapoloVerify: ESysApoloStatus.PENDIENTE,
      emailSend: EEmailStatus.PENDIENTE,
      detailInvoices: detailInvoice,
    });
  }

  async generateInvoiceVariousByInvoice(
    params: IGenerateInvoice,
  ): Promise<Invoice> {
    const config = await this.configRepository.getCurrentConfig();
    if (!config) throw new NotFoundError('No se encontro la configuracion');

    const { codPaquete, infoEstudiante, matriculaId, cantidad } = params;

    const packageInvoce = await this.packageRepository.findConceptsByCode(
      codPaquete,
    );
    if (!packageInvoce) throw new NotFoundError('No se encontro el paquete');

    const { packageDetail, categoriaId } = packageInvoce;

    const discounts = await this.discountRepository.findForInvoiceGeneral(
      categoriaId,
      infoEstudiante.ide_persona,
    );
    const infoClient: IInfoInvoice = {
      info_cliente: params.infoEstudiante,
    };

    const aumentoExtra: number = discounts
      .filter((discount) => discount.accion == '0')
      .reduce((a, b) => a + b.porcentaje, 0);

    const descuentoExtra: number = discounts
      .filter((discount) => discount.accion == '1')
      .reduce((a, b) => a + b.porcentaje, 0);
    const detailInvoice = this.detailInvoiceRepository.create(
      createDetailInvoice({
        packageDetail,
        aumentoExtra,
        descuentoExtra,
        quantity: cantidad,
      }),
    );
    const { totalExtraordinario: total } = calcularTotales(detailInvoice);

    const generateEnd = generateEndDatePayment();

    return this.invoiceRepository.create({
      estadoId: EStatusInvoice.PAGO_INICADO,
      estudianteId: infoEstudiante.ide_persona,
      codigo: generateCodeInvoice(infoEstudiante),
      matriculaId: matriculaId,
      jsonResponse: JSON.stringify(infoClient),
      valor: total,
      periodoId: infoEstudiante.cod_periodo,
      codPaquete: codPaquete,
      isOnline: params.isPagoOnline ? EOnlinePayment.SI : EOnlinePayment.NO,
      categoriaPagoId: categoriaId,
      fechaUpdate: new Date(),
      fechaLimite: generateEndDatePayment(),
      sysapoloVerify: ESysApoloStatus.PENDIENTE,
      emailSend: EEmailStatus.PENDIENTE,
      detailInvoices: detailInvoice,
    });
  }

  async generateInvoiceRegistration(
    params: IGenerateInvoice,
  ): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    const [infoMatricula] = await queryRunner.manager.query<IEnrollment[]>(
      INFO_MATRICULA_SQL,
      [params.matriculaId],
    );
    if (!queryRunner.isReleased) await queryRunner.release();

    if (!infoMatricula) throw new NotFoundError('No se encontro la matricula');

    const config = await this.configRepository.getCurrentConfig();
    if (!config) throw new NotFoundError('No se encontro la configuracion');

    const { codPaquete } = params;
    const codeEnumPackage = Object.values(EPackageCode).includes(
      codPaquete as EPackageCode,
    )
      ? (codPaquete as EPackageCode)
      : EPackageCode.INSCRIPCION;

    const packageInvoce = await this.packageRepository.findConceptsByCode(
      codeEnumPackage,
    );
    if (!packageInvoce) throw new NotFoundError('No se encontro el paquete');

    const { packageDetail, categoriaId } = packageInvoce;

    const [period, discounts] = await Promise.all([
      this.periodRepository.findOne({
        where: {
          codPeriodo: infoMatricula.cod_periodo,
          codColegio: infoMatricula.cod_colegio,
        },
      }),
      this.discountRepository.findForEnrollment(
        categoriaId,
        infoMatricula.ide_persona,
        infoMatricula.cod_periodo,
      ),
    ]);

    if (!period) throw new NotFoundError('No se encontro el periodo academico');

    const { fecFinInsNuevos } = period;

    const aumentoExtra: number = discounts
      .filter((discount) => discount.accion == '0')
      .reduce((a, b) => a + b.porcentaje, 0);

    const descuentoExtra: number = discounts
      .filter((discount) => discount.accion == '1')
      .reduce((a, b) => a + b.porcentaje, 0);
    const detailInvoice = this.detailInvoiceRepository.create(
      createDetailInvoice({ packageDetail, aumentoExtra, descuentoExtra }),
    );

    const infoClient: IInfoInvoice = {
      info_cliente: params.infoEstudiante,
    };

    const { totalExtraordinario: total } = calcularTotales(detailInvoice);
    return this.invoiceRepository.create({
      estadoId: EStatusInvoice.PAGO_INICADO,
      estudianteId: infoMatricula.ide_persona,
      codigo: generateCodeInvoice(infoMatricula),
      matriculaId: params.matriculaId,
      valor: total,
      jsonResponse: JSON.stringify(infoClient),
      periodoId: infoMatricula.cod_periodo,
      codPaquete: codeEnumPackage,
      isOnline: params.isPagoOnline ? EOnlinePayment.SI : EOnlinePayment.NO,
      categoriaPagoId: categoriaId,
      fechaUpdate: new Date(),
      fechaLimite: fecFinInsNuevos ?? generateEndDatePayment(),
      sysapoloVerify: ESysApoloStatus.PENDIENTE,
      emailSend: EEmailStatus.PENDIENTE,
      detailInvoices: detailInvoice,
    });
  }

  async generateInvoiceEnrrolment(params: IGenerateInvoice): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    const [infoMatricula] = await queryRunner.manager.query<IEnrollment[]>(
      INFO_MATRICULA_SQL,
      [params.matriculaId],
    );

    if (!queryRunner.isReleased) await queryRunner.release();

    if (!infoMatricula) throw new NotFoundError('No se encontro la matricula');

    const config = await this.configRepository.getCurrentConfig();
    if (!config) throw new NotFoundError('No se encontro la configuracion');

    let quantity = 0;
    let codPaquete = '0';
    if (
      infoMatricula.nro_creditos > config.minCreditos ||
      infoMatricula.nro_creditos == 0
    ) {
      codPaquete = PACKAGE_TYPE.COMPLETO[infoMatricula.cod_nivel_edu];
    } else {
      codPaquete = PACKAGE_TYPE.INDIVIDUAL[infoMatricula.cod_nivel_edu];
      quantity = infoMatricula.nro_creditos;
    }

    const packageInvoce = await this.packageRepository.findConceptsByCode(
      codPaquete,
    );
    if (!packageInvoce) throw new NotFoundError('No se encontro el paquete');

    const { packageDetail, categoriaId } = packageInvoce;

    const [discounts, studentType] = await Promise.all([
      this.discountRepository.findForEnrollment(
        categoriaId,
        infoMatricula.ide_persona,
        infoMatricula.cod_periodo,
      ),
      this.enrollmentService.generateStudentTypeByEnrollment(infoMatricula),
    ]);

    const currenDate = new Date();

    let aumentoExtra: number = discounts
      .filter((discount) => discount.accion == '0')
      .reduce((a, b) => a + b.porcentaje, 0);

    const descuentoExtra: number = discounts
      .filter((discount) => discount.accion == '1')
      .reduce((a, b) => a + b.porcentaje, 0);

    const momentCurrent = moment().utcOffset(-5);

    const momentDb = moment(studentType.fechaFinMatricula)
      .utcOffset(-5)
      .set({ hour: 23, minute: 59, second: 59 });

    if (momentCurrent > momentDb && !isNull(studentType.fechaFinMatricula)) {
      aumentoExtra = aumentoExtra + config.porcentajeExt;
    }

    const detailInvoice = this.detailInvoiceRepository.create(
      createDetailInvoice({
        packageDetail,
        aumentoExtra,
        descuentoExtra,
        quantity,
        categoriaId,
      }),
    );
    const infoClient: IInfoInvoice = {
      info_cliente: params.infoEstudiante,
    };

    const { totalExtraordinario: total } = calcularTotales(detailInvoice);
    return this.invoiceRepository.create({
      estadoId: EStatusInvoice.PAGO_INICADO,
      estudianteId: infoMatricula.ide_persona,
      codigo: generateCodeInvoice(infoMatricula),
      matriculaId: params.matriculaId,
      valor: total,
      periodoId: infoMatricula.cod_periodo,
      jsonResponse: JSON.stringify(infoClient),
      codPaquete,
      fechaLimite: studentType.fechaFinMatriculaExt,
      isOnline: params.isPagoOnline ? EOnlinePayment.SI : EOnlinePayment.NO,
      categoriaPagoId: categoriaId,
      fechaUpdate: new Date(),
      sysapoloVerify: ESysApoloStatus.PENDIENTE,
      emailSend: EEmailStatus.PENDIENTE,
      detailInvoices: detailInvoice,
    });
  }
}
