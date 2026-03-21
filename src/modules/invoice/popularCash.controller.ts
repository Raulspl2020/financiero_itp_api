import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import * as moment from 'moment';
import { IPaymentRegister } from 'src/interfaces/payment.interface';
import { getStatusInvoicePaymentWs } from 'src/utils/webService.util';
import { NotFoundError } from '../../classes/httpError/notFounError';
import {
  EResponseDescription,
  EResposeStatusCode,
  IResponseInvoice,
} from '../../interfaces/responseInvoice.interface';
import { MESSAGE_RESPONSE_REVERSE } from './constant/invoice.constant';
import { BbvaRegisterPaymentDto } from './dto/bbva-register-payment';
import { PopularRegisterPaymentDto } from './dto/popular-register-payment.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import { ValidateInvoiceDto } from './dto/validate-invoice.dto';
import {
  EBankCash,
  ERegisterDescription,
  ESeverity,
  ESeverityCode,
  EStatusInvoice,
} from './enums/invoice.enum';
import { RequesLogtInterceptor } from './interceptors/requestLog.interceptor';
import { InvoiceRepository } from './repositories/invoice.repository';
import { ConsultInvoiceService } from './services/consultInvoice.service';
import { InvoiceService } from './services/invoice.service';
import { InvoiceSysService } from './services/invoiceSys.service';
@ApiTags('Paying invoices: Banco Popular')
@Controller('caja')
export class PopularCashController {
  private readonly logger = new Logger('POPULAR-ENDPOINT');

  private normalizePopularTransactionCode(transactionCode: string): string {
    const code = `${transactionCode ?? ''}`.trim();
    const match = code.match(/^(\d{8})(\d{6})(.*)$/);
    if (!match) return code;
    const [, yyyymmdd, , rest] = match;
    return `${yyyymmdd}${rest}`;
  }

  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly invoiceSysService: InvoiceSysService,
    private readonly consultInvoiceService: ConsultInvoiceService,
    private readonly invoiceRepository: InvoiceRepository,
  ) {}

  @Get('/consultarfactura')
  @ApiResponse({
    status: 200,
    description: 'The consultation is successful',
  })
  @ApiResponse({ status: 400, description: 'Data validation error' })
  @HttpCode(200)
  async consultarFactura(@Query() payload: ValidateInvoiceDto) {
    try {
      const invoice = await this.consultInvoiceService.searchInvoiceForPayment(
        Number(payload.referencia_pago),
      );

      const dateInvoice = moment(invoice.fechaLimite || new Date()).startOf(
        'day',
      );
      const dateCurrent = moment(new Date()).startOf('day');

      if (dateCurrent > dateInvoice) {
        return {
          valor_factura: 0,
          descripcion_estado: EResponseDescription.WARNING,
          codigo_estado: EResposeStatusCode.WARNING,
          fecha_limite_pago: moment(invoice.fechaLimite || new Date()).format(
            'DD/MM/YYYY',
          ),
          descripcion_general: 'Factura vencida',
        };
      }

      const response: IResponseInvoice = {
        valor_factura: invoice.valor,
        descripcion_estado: EResponseDescription.OK,
        codigo_estado: EResposeStatusCode.OK,
        fecha_limite_pago: moment(invoice.fechaLimite || new Date()).format(
          'DD/MM/YYYY',
        ),
      };
      return response;
    } catch (error) {
      return {
        valor_factura: 0,
        descripcion_estado: EResponseDescription.WARNING,
        codigo_estado: EResposeStatusCode.WARNING,
        fecha_limite_pago: moment(new Date()).format('DD/MM/YYYY'),
        descripcion_general: error?.message ?? null,
      };
    }
  }

  // @Get('/notificacion')
  // @HttpCode(200)
  // async notificacionFactura(@Query() payload: ValidateInvoiceDto, @Res() res) {
  //   const invoice = await this.invoiceRepository.findById(
  //     Number(payload.referencia_pago),
  //   );
  //   if (!invoice) throw new NotFoundError('Factura no encontrada');

  //   const responsePayment = await getStatusInvoicePaymentWs(
  //     payload.referencia_pago,
  //   );
  //   if (!responsePayment)
  //     throw new NotFoundError('No se encontraron pagos en el banco');

  //   const registerInvoice = await this.invoiceService
  //     .registerPaymentCash(responsePayment, invoice)
  //     .catch(console.log);

  //   this.invoiceSysService
  //     .registerInvoiceSysApolo(invoice.id)
  //     .catch(console.log);

  //   return res.send();
  // }

  @UseInterceptors(RequesLogtInterceptor)
  @ApiHeader({
    name: 'X-Token',
    description:
      'Token required for authentication, use: qwer in test environment',
    required: true,
    example: 'qwer',
  })
  @ApiResponse({ status: 403, description: 'Data validation error' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({
    status: 200,
    description: 'The consultation is successful',
  })
  @HttpCode(200)
  @Post('/registrarpago')
  async registrarFactura(@Body() payload: PopularRegisterPaymentDto) {
    try {
      const invoice = await this.invoiceRepository.findById(
        Number(payload.referencia_pago),
      );

      if (!invoice) throw new NotFoundError('Factura no encontrada');

      const dateInvoice = moment(invoice.fechaLimite || new Date()).startOf(
        'day',
      );
      const dateCurrent = moment(new Date()).startOf('day');

      if (dateCurrent > dateInvoice) {
        return {
          descripcion: ERegisterDescription.WARNING,
          severidad: ESeverity.WARNING,
          codigo_estado: ESeverityCode.WARNING,
        };
      }

      const normalizedTransactionCode = this.normalizePopularTransactionCode(
        payload.codigo_transaccion,
      );

      const payloadRegister: IPaymentRegister = {
        date: payload.fecha_pago,
        invoiceId: Number(payload.referencia_pago),
        status: EStatusInvoice.PAGO_FINALIZADO_OK,
        transactionCode: normalizedTransactionCode,
        value: payload.valor_pagado,
        bankId: payload.id_banco,
        name_bank: EBankCash.POPULAR,
      };

      const success = await this.invoiceService.registerPaymentCash(
        payloadRegister,
        invoice,
      );

      if (success) {
        return {
          descripcion: ERegisterDescription.INFORMATIVE,
          severidad: ESeverity.INFORMATIVE,
          codigo_estado: ESeverityCode.INFORMATIVE,
        };
      }

      return {
        descripcion: ERegisterDescription.WARNING,
        severidad: ESeverity.WARNING,
        codigo_estado: ESeverityCode.WARNING,
      };
    } catch (error) {
      this.logger.warn(error);
      return {
        descripcion: ERegisterDescription.ERROR,
        severidad: ESeverity.ERROR,
        codigo_estado: ESeverityCode.ERROR,
      };
    }
  }

  @ApiHeader({
    name: 'X-Token',
    description:
      'Token required for authentication, use: qwer in test environment',
    required: true,
    example: 'qwer',
  })
  @ApiResponse({ status: 403, description: 'Data validation error' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({
    status: 200,
    description: 'The consultation is successful',
  })
  @Post('/reverso')
  @HttpCode(200)
  async reversoFactura(@Body() payload: ReversePaymentDto) {
    try {
      let status = await this.invoiceService.reversePayment(payload);

      const normalizedTransactionCode = this.normalizePopularTransactionCode(
        payload.codigo_transaccion,
      );

      if (
        status === ESeverityCode.WARNING &&
        normalizedTransactionCode !== payload.codigo_transaccion
      ) {
        status = await this.invoiceService.reversePayment({
          ...payload,
          codigo_transaccion: normalizedTransactionCode,
        });
      }

      const response = {
        codigo_estado: status,
        severidad: Object.values(ESeverity)[status],
        descripcion: MESSAGE_RESPONSE_REVERSE[status],
      };

      return response;
    } catch (error) {
      this.logger.warn(error);
      return {
        descripcion: MESSAGE_RESPONSE_REVERSE[2],
        severidad: ESeverity.ERROR,
        codigo_estado: EResposeStatusCode.ERROR,
      };
    }
  }
}
