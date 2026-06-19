import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { getBaseUrl } from 'src/config/environments';
import { IInvoiceResponse } from 'src/interfaces/invoice.interface';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { GenerateInvoiceService } from './services/generateInvoice.service';
import { isOnlinePay } from '../../utils/invoice.util';
import { InvoiceService } from './services/invoice.service';
import { InvoiceSysService } from './services/invoiceSys.service';
import { SendPaymentDto } from './dto/send-payment.dto';
import { EnrollmentService } from './services/enrollment.service';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController(true)
@Controller('invoice')
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly sysApoloService: InvoiceSysService,
    private readonly generateInvoiceService: GenerateInvoiceService,
    private readonly enrollmentService: EnrollmentService,
  ) {}

  @Get('payment/pdf/:id')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'inline; filename=file.pdf')
  async getPdfPaymentReceipt(@Param('id', ParseIntPipe) invoiceId: number) {
    const buffer = await this.invoiceService.getPdfPaymentReceipt(invoiceId);
    return new StreamableFile(buffer);
  }

  @Get('payment/html/:id')
  @Header('content-type', 'text/html')
  async getHTMLPaymentReceipt(@Param('id', ParseIntPipe) invoiceId: number) {
    return this.invoiceService.getHTMLPaymentReceipt(invoiceId);
  }

  @Get('register/sysapolo/:id')
  async registerInvoiceSysApolo(@Param('id', ParseIntPipe) invoiceId: number) {
    return this.sysApoloService.registerInvoiceSysApolo(invoiceId);
  }

  @Post('send/payment/:id')
  async sendPaymentEmail(
    @Param('id', ParseIntPipe) invoiceId: number,
    @Body() payload: SendPaymentDto,
  ) {
    return this.invoiceService.sendPaymentEmail(invoiceId, payload.important);
  }

  @Get('info/:id')
  async getInfoInvoice(@Param('id', ParseIntPipe) invoiceId: number) {
    const startedAt = Date.now();
    console.log(`[perf:financiero_itp_api] GET /api/v2/invoice/info/${invoiceId} start params=${JSON.stringify({ invoiceId })}`);
    try {
      const { jsonResponse, ...rest } = await this.invoiceService.getInfoInvoice(
        invoiceId,
      );
      const response = {
        jsonResponse: JSON.parse(jsonResponse),
        ...rest,
      };
      console.log(`[perf:financiero_itp_api] GET /api/v2/invoice/info/${invoiceId} total ${Date.now() - startedAt}ms`);
      return response;
    } catch (error) {
      console.log(`[perf:financiero_itp_api] GET /api/v2/invoice/info/${invoiceId} failed ${Date.now() - startedAt}ms error=${error?.message}`);
      throw error;
    }
  }

  @Post('generate')
  async generateInvoice(@Body() payload: GenerateInvoiceDto) {
    const { jsonResponse, ...rest } =
      await this.generateInvoiceService.mainGenerateInvoice(payload);
    return {
      jsonResponse: JSON.parse(jsonResponse),
      ...rest,
    };
  }

  @Post('create')
  async createInvoice(
    @Body() payload: GenerateInvoiceDto,
  ): Promise<IInvoiceResponse> {
    const startedAt = Date.now();
    console.log(`[perf:financiero_itp_api] POST /api/v2/invoice/create start params=${JSON.stringify({ matriculaId: payload?.matriculaId, personaId: payload?.personaId, codPaquete: payload?.codPaquete, isPagoOnline: payload?.isPagoOnline })}`);
    try {
      const { isOnline, id } =
        await this.generateInvoiceService.generateAndSaveInvoice(payload);

      const response = {
        redirectPayment: isOnlinePay(isOnline)
          ? null
          : `${getBaseUrl()}/invoice/pdf/${id}`,
        error: false,
        message: 'Ejecucion correcta',
        invoiceId: id,
      };
      console.log(`[perf:financiero_itp_api] POST /api/v2/invoice/create total ${Date.now() - startedAt}ms invoiceId=${id}`);
      return response;
    } catch (error) {
      console.log(error);
      console.log(`[perf:financiero_itp_api] POST /api/v2/invoice/create failed ${Date.now() - startedAt}ms error=${error?.message}`);
      return {
        redirectPayment: null,
        error: true,
        message: error?.message,
      };
    }
  }

  @Get('pdf/:id')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'inline; filename=file.pdf')
  async generateInvoicePdf(@Param('id', ParseIntPipe) invoiceId: number) {
    const startedAt = Date.now();
    console.log(`[perf:financiero_itp_api] GET /api/v2/invoice/pdf/${invoiceId} start params=${JSON.stringify({ invoiceId })}`);
    try {
      const buffer = await this.generateInvoiceService.getPdfInvoice(invoiceId);
      console.log(`[perf:financiero_itp_api] GET /api/v2/invoice/pdf/${invoiceId} total ${Date.now() - startedAt}ms bytes=${buffer?.length || 0}`);
      return new StreamableFile(buffer);
    } catch (error) {
      console.log(`[perf:financiero_itp_api] GET /api/v2/invoice/pdf/${invoiceId} failed ${Date.now() - startedAt}ms error=${error?.message}`);
      throw error;
    }
  }

  @Get('html/:id')
  @Header('content-type', 'text/html')
  async generateInvoiceHtml(@Param('id', ParseIntPipe) invoiceId: number) {
    const startedAt = Date.now();
    console.log(`[perf:financiero_itp_api] GET /api/v2/invoice/html/${invoiceId} start params=${JSON.stringify({ invoiceId })}`);
    try {
      const html = await this.generateInvoiceService.getHtmlInvoice(invoiceId);
      console.log(`[perf:financiero_itp_api] GET /api/v2/invoice/html/${invoiceId} total ${Date.now() - startedAt}ms chars=${html?.length || 0}`);
      return html;
    } catch (error) {
      console.log(`[perf:financiero_itp_api] GET /api/v2/invoice/html/${invoiceId} failed ${Date.now() - startedAt}ms error=${error?.message}`);
      throw error;
    }
  }

  @Get('studenttype')
  async getStudentType(@Query('matriculaId') matriculaId: number) {
    return this.enrollmentService.getDatesStudentType(matriculaId);
  }

  @Get('sysapolo/send-bulk')
  async registerSysApoloMasive() {
    return this.sysApoloService.registerInvoiceMasive();
  }
}
