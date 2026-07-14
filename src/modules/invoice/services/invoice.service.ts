import { ISendMailOptions, MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger } from '@nestjs/common';
import { isEmpty } from 'lodash';
import Mail from 'nodemailer/lib/mailer';
import { resolve } from 'path';
import { DataSource, DeepPartial, In, Repository } from 'typeorm';
import { IInfoInvoice } from '../../../interfaces/enrollment.interface';
import {
  IDiscount,
  IPaymentReceipt,
  IPaymentRegister,
  IPaymentSearch,
} from '../../../interfaces/payment.interface';
import { messageEmailPaymentOk } from '../../../utils/messages.util';
import {
  deduplicateDiscountsByCategory,
  filterDiscountsForEnrollment,
} from '../../../utils/discountEligibility.util';
import {
  compileHBS,
  convertHTMLtoPDF,
  initializeHelpersHbs,
} from '../../../utils/reportPdf.util';

import { InjectRepository } from '@nestjs/typeorm';
import * as moment from 'moment';
import { NotFoundError } from 'src/classes/httpError/notFounError';
import { getBaseUrl } from 'src/config/environments';
import {
  calcularTotales,
  createQRBase64,
  llenarSubTotal,
} from '../../../utils/invoice.util';
import { ReversePaymentDto } from '../dto/reverse-payment.dto';
import { DetailPayment } from '../entities/detailPayment.entity';
import { Discounts } from '../entities/discounts.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceDiscounts } from '../entities/invoiceDiscounts.entity';
import {
  EDiscountStatus,
  EEmailStatus,
  EFormPayment,
  EOnlinePayment,
  ESeverityCode,
  EStatusInvoice,
  ESysApoloStatus,
} from '../enums/invoice.enum';
import { DetailPaymentRepository } from '../repositories/detailPayment.repository';
import { DiscountRepository } from '../repositories/discount.repository';
import { InvoiceRepository } from '../repositories/invoice.repository';
import { InvoiceSysService } from './invoiceSys.service';
import { SentMessageInfo } from 'nodemailer';
import { ConfigService } from '@nestjs/config';
@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly invoiceSysService: InvoiceSysService,
    private readonly detailPaymentRepository: DetailPaymentRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly dataSource: DataSource,
    private mailerService: MailerService,

    private discountRepository: DiscountRepository,

    @InjectRepository(InvoiceDiscounts)
    private invoiceDiscountsRepository: Repository<InvoiceDiscounts>,
    private configService: ConfigService,
  ) {}

  async registerPaymentCash(payload: IPaymentRegister, invoice: Invoice) {
    const searchData: IPaymentSearch = { ...payload };

    const payments = await this.detailPaymentRepository.findPaymentsForReverse(
      searchData,
    );

    if (!isEmpty(payments)) return false;
    const registered = await this.registerPaymentInvoiceSigedin(payload);

    if (registered) {
      const { person, categoryInvoice, categoriaPagoId, jsonResponse } =
        invoice;

      const { info_cliente: infoMatricula }: IInfoInvoice =
        JSON.parse(jsonResponse);

      const discountsRaw = await this.discountRepository.findForEnrollment(
        categoriaPagoId,
        infoMatricula?.ide_persona,
        infoMatricula?.cod_periodo,
        invoice.matriculaId,
      );
      const discounts = deduplicateDiscountsByCategory(
        filterDiscountsForEnrollment(discountsRaw, infoMatricula),
      );

      try {
        await this.invoiceSysService.registerInvoiceSysApolo(payload.invoiceId);
      } catch (error) {
        const errorDetail =
          error instanceof Error ? error.stack ?? error.message : `${error}`;
        this.logger.error(
          `Fallo sincronizando factura ${payload.invoiceId} con SysApolo`,
          errorDetail,
        );
      }

      try {
        await this.registerDiscuountInvoice(payload.invoiceId, discounts);
        const buffer = await this.getPdfPaymentReceipt(searchData.invoiceId);
        const attachment: Mail.Attachment = {
          content: buffer,
          filename: `${person.id}-${searchData.transactionCode}.pdf`,
          contentType: 'application/pdf',
        };
        const mailOptions: ISendMailOptions = {
          to:
            this.configService.get<string>('NODE_ENV') != 'pro'
              ? this.configService.get<string>('EMAIL_TEST')
              : person.email,
          subject: 'Recibo de pago - Pago exitoso',
          text: messageEmailPaymentOk(
            person,
            categoryInvoice.descripcion,
            invoice.id,
          ),
          attachments: [attachment],
        };

        if (invoice.emailSend != EEmailStatus.ENVIADO) {
          this.mailerService
            .sendMail(mailOptions)
            .then(() => {
              this.invoiceRepository
                .updateStatusEmailSend(
                  EEmailStatus.ENVIADO,
                  searchData.invoiceId,
                )
                .catch(console.log);
            })
            .catch((error) => {
              console.log('No se ha podido enviar el recibo de pago: ', error);
            });
        }
      } catch (error) {
        console.log('No se ha podido registrar los descuentos: ', error);
      }
    }

    return registered;
  }

  async registerPaymentInvoiceSigedin(
    payload: IPaymentRegister,
  ): Promise<boolean> {
    const { invoiceId, value, transactionCode, status, date, bankId } = payload;
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const payment: DeepPartial<DetailPayment> = {
        facturaId: invoiceId,
        valorPago: value,
        totalPago: value,
        fecha: date,
        estadoPagoId: status,
        formaPagoId: EFormPayment.EFECTIVO,
        codigoTransaccion: transactionCode,
        bancoRecaudoId: bankId,
        nombreBanco: payload.name_bank,
      };

      const invoice: DeepPartial<Invoice> = {
        estadoId: EStatusInvoice.PAGO_FINALIZADO_OK,
        fechaUpdate: new Date(),
        isOnline: EOnlinePayment.NO, //TODO: if is payment online then refactor
      };

      await queryRunner.manager.insert(DetailPayment, payment);

      await queryRunner.manager.update(
        Invoice,
        {
          id: invoiceId,
        },
        invoice,
      );
      await queryRunner.commitTransaction();
      return true;
    } catch (error) {
      console.log(error);
      await queryRunner.rollbackTransaction();
      return false;
    } finally {
      if (!queryRunner.isReleased) await queryRunner.release();
    }
  }

  // Main reverse payment
  async reversePayment(payload: ReversePaymentDto): Promise<ESeverityCode> {
    const searchData: IPaymentSearch = {
      invoiceId: payload.referencia_pago,
      transactionCode: payload.codigo_transaccion,
      value: payload.valor_pagado,
    };

    const payments = await this.detailPaymentRepository.findPaymentsForReverse(
      searchData,
    );

    if (isEmpty(payments)) return ESeverityCode.WARNING;
    const ids = payments.map((row) => row.id);

    const isValid = payments.some((payment) => {
      const now = moment(payload.fecha_reverso); //todays date
      const end = moment(payment.fecha);
      const duration = moment.duration(now.diff(end));
      console.log(duration.asHours());
      return duration.asHours() < 12;
    });

    if (!isValid) return ESeverityCode.WARNING;

    const deleted = await this.deletePaymentInvoiceSigedin(payload, ids);
    if (deleted) {
      this.invoiceSysService.deleteInvoiceSysApolo(payload.referencia_pago);
      this.deleteDiscuountInvoice(payload.referencia_pago);
      return ESeverityCode.INFORMATIVE;
    }

    return ESeverityCode.ERROR;
  }

  async deletePaymentInvoiceSigedin(
    payload: ReversePaymentDto,
    ids: string[],
  ): Promise<boolean> {
    const { referencia_pago, valor_pagado, fecha_reverso } = payload;
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      await queryRunner.manager.delete(DetailPayment, {
        id: In(ids),
      });

      const invoice: DeepPartial<Invoice> = {
        estadoId: EStatusInvoice.PAGO_INICADO,
        fechaReverso: fecha_reverso,
        valorReverso: valor_pagado,
        fechaUpdate: new Date(),
        sysapoloVerify: ESysApoloStatus.PENDIENTE,
      };

      await queryRunner.manager.update(
        Invoice,
        {
          id: referencia_pago,
        },
        invoice,
      );
      await queryRunner.commitTransaction();
      return true;
    } catch (error) {
      console.log(error);
      await queryRunner.rollbackTransaction();
      return false;
    } finally {
      if (!queryRunner.isReleased) await queryRunner.release();
    }
  }

  async getDetailInvoice(invoiceId: number) {
    return this.invoiceRepository.findFullById(invoiceId);
  }

  async getHTMLPaymentReceipt(invoiceId: number): Promise<string> {
    const invoiceFull = await this.invoiceRepository.findFullById(invoiceId);

    if (!invoiceFull)
      throw new NotFoundError(`La factura ${invoiceId}, no ha sido pagada`);

    const {
      jsonResponse,
      categoryInvoice,
      detailInvoices,
      detailPayments,
      invoiceDiscounts,
      ...invoice
    } = invoiceFull;

    const { info_cliente }: IInfoInvoice = JSON.parse(jsonResponse);
    const { totalExtraordinario: total } = calcularTotales(detailInvoices);

    const url = `${getBaseUrl()}/invoice/payment/pdf/${invoice.id}`;
    const qrBase64 = await createQRBase64(url);

    const dataReport: IPaymentReceipt = {
      client: info_cliente,
      category: categoryInvoice,
      detailInvoice: llenarSubTotal(detailInvoices),
      detailPayment: detailPayments,
      invoice,
      totalInt: total,
      qrBase64,
      url,
      discounts: invoiceDiscounts.map<IDiscount>(({ discount }) => {
        return {
          id: discount?.id,
          discountCategory: discount?.discountCategory?.descripcion,
          fecha: discount?.fecha,
          porcentajeEstadoId: discount?.porcentajeEstadoId,
          porcentaje: discount.porcentaje ?? 0,
        };
      }),
    };
    const pathTemplateBody = resolve(
      __dirname,
      '../../../',
      'templates/reciboPago.pdf.hbs',
    );

    initializeHelpersHbs();
    const templateHtml = compileHBS(pathTemplateBody, dataReport);
    return templateHtml;
  }

  async getPdfPaymentReceipt(invoiceId: number): Promise<Buffer> {
    const templateHtml = await this.getHTMLPaymentReceipt(invoiceId);
    const buffer = await convertHTMLtoPDF(templateHtml);
    return buffer;
  }

  async getInfoInvoice(invoiceId: number) {
    const startedAt = Date.now();
    const invoice = await this.invoiceRepository.findById(invoiceId);
    console.log(`[perf:financiero_itp_api:invoice.info] invoiceRepository.findById: ${Date.now() - startedAt}ms invoiceId=${invoiceId}`);
    if (!invoice)
      throw new NotFoundError(`No se encontro la factura con id ${invoiceId}`);
    return invoice;
  }

  async registerDiscuountInvoice(
    invoiceId: number,
    discounts: Discounts[],
  ): Promise<boolean> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const selectedDiscounts = deduplicateDiscountsByCategory(discounts);
      if (selectedDiscounts.length === 0) {
        await queryRunner.commitTransaction();
        return true;
      }

      const insertDiscounts = selectedDiscounts.map<DeepPartial<InvoiceDiscounts>>(
        (discount) => {
          return {
            facturaId: invoiceId,
            porcentajeSoporteId: discount.id,
          };
        },
      );

      for (const dto of selectedDiscounts) {
        await queryRunner.manager.update(
          Discounts,
          {
            id: dto.id,
          },
          { porcentajeEstadoId: EDiscountStatus.FACTURADO },
        );
      }

      await queryRunner.manager.insert(InvoiceDiscounts, insertDiscounts);

      await queryRunner.commitTransaction();
      return true;
    } catch (error) {
      console.log(error);
      await queryRunner.rollbackTransaction();
      return false;
    } finally {
      if (!queryRunner.isReleased) await queryRunner.release();
    }
  }

  async deleteDiscuountInvoice(invoiceId: number): Promise<boolean> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      const invoiceDiscounts = await this.invoiceDiscountsRepository.find({
        where: { facturaId: invoiceId },
      });

      const ids = invoiceDiscounts.map((dto) => dto.porcentajeSoporteId);

      await queryRunner.manager.update(
        Discounts,
        {
          id: In(ids),
        },
        { porcentajeEstadoId: EDiscountStatus.APROBADO },
      );

      await queryRunner.manager.delete(InvoiceDiscounts, {
        facturaId: invoiceId,
      });

      await queryRunner.commitTransaction();
      return true;
    } catch (error) {
      console.log(error);
      await queryRunner.rollbackTransaction();
      return false;
    } finally {
      if (!queryRunner.isReleased) await queryRunner.release();
    }
  }

  async sendPaymentEmail(
    invoiceId: number,
    important?: boolean,
  ): Promise<SentMessageInfo> {
    const invoice = await this.invoiceRepository.findOneForEmail(invoiceId);

    if (!invoice)
      throw new NotFoundError(`No se encontro la factura con id ${invoiceId}`);

    if (invoice.emailSend == EEmailStatus.ENVIADO && !important) {
      throw new NotFoundError(
        `La factura ${invoiceId} ya fue enviada a: ${invoice.person.email}`,
      );
    }

    const {
      person,
      categoryInvoice,
      jsonResponse,
      detailPayments = [],
    } = invoice;

    const paymentFound = detailPayments.find(
      (payment) => payment.estadoPagoId == EStatusInvoice.PAGO_FINALIZADO_OK,
    );

    if (!paymentFound)
      throw new NotFoundError(`La factura ${invoiceId} no contiene pagos`);

    const { info_cliente }: IInfoInvoice = JSON.parse(jsonResponse);
    const buffer = await this.getPdfPaymentReceipt(invoiceId);

    const attachment: Mail.Attachment = {
      content: buffer,
      filename: `${info_cliente?.ide_persona}-${paymentFound?.facturaId}.pdf`,
      contentType: 'application/pdf',
    };
    const mailOptions: ISendMailOptions = {
      to:
        this.configService.get<string>('NODE_ENV') != 'pro'
          ? this.configService.get<string>('EMAIL_TEST')
          : person.email,
      subject: 'Recibo de pago - Pago exitoso',
      text: messageEmailPaymentOk(
        person,
        categoryInvoice.descripcion,
        invoice.id,
      ),
      attachments: [attachment],
    };

    const sendInfo = await this.mailerService.sendMail(mailOptions);

    this.invoiceRepository
      .updateStatusEmailSend(EEmailStatus.ENVIADO, invoiceId)
      .catch(console.log);

    return sendInfo;
  }
}
