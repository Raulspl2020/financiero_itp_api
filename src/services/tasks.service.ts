import { Injectable, Logger } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { InvoiceRepository } from 'src/modules/invoice/repositories/invoice.repository';
import { CronExpression } from '../constants/cronExpression.enum';
import { CronJob } from 'cron';
import { InvoiceSysService } from 'src/modules/invoice/services/invoiceSys.service';
import { InvoiceService } from 'src/modules/invoice/services/invoice.service';
import { DetailPaymentRepository } from 'src/modules/invoice/repositories/detailPayment.repository';

@Injectable()
export class TasksService {
  constructor(
    private readonly invoiceRepository: InvoiceRepository,
    private readonly detailPaymentRepository: DetailPaymentRepository,
    private schedulerRegistry: SchedulerRegistry,
    private invoiceSysService: InvoiceSysService,
    private readonly invoiceService: InvoiceService,
  ) {
    this.registerJobInvoicesSysApolo();
  }
  private readonly logger = new Logger(TasksService.name);

  // @Cron(CronExpression.EVERY_DAY_AT_3AM)
  // async deleteUnpaidInvoices() {
  //   const deleteInvoices = await this.invoiceRepository.deleteInvoices();
  //   this.logger.debug('The following invoices was removed', deleteInvoices);
  // }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sendPendingPaymentsToEmail() {
    const startedAt = Date.now();
    this.logger.warn(`[perf] cron sendPendingPaymentsToEmail inicio`);
    this.logger.warn(`start cron job sendPendingPaymentsToEmail`);
    const queryStartedAt = Date.now();
    const payments = await this.detailPaymentRepository.findPaymentsOkByDate();
    this.logger.warn(
      `[perf:financiero_itp_api:cron.sendPendingPaymentsToEmail] findPaymentsOkByDate: ${Date.now() - queryStartedAt}ms rows=${payments.length}`,
    );
    this.logger.warn(
      `[perf] SQL findPaymentsOkByDate ${Date.now() - queryStartedAt}ms`,
    );

    for (const { invoice } of payments) {
      try {
        const emailStartedAt = Date.now();
        const responseEmail = await this.invoiceService.sendPaymentEmail(
          invoice.id,
        );
        this.logger.warn(
          `[perf:financiero_itp_api:cron.sendPendingPaymentsToEmail] sendPaymentEmail invoiceId=${invoice.id}: ${Date.now() - emailStartedAt}ms`,
        );
        this.logger.warn(
          `[perf] sendPaymentEmail ${Date.now() - emailStartedAt}ms`,
        );
      } catch (error) {
        this.logger.warn(error);
      }
    }

    this.logger.warn(
      `[perf:financiero_itp_api:cron.sendPendingPaymentsToEmail] total ${Date.now() - startedAt}ms rows=${payments.length}`,
    );
    this.logger.warn(
      `[perf] cron sendPendingPaymentsToEmail fin ${Date.now() - startedAt}ms`,
    );
  }

  async registerJobInvoicesSysApolo() {
    const job = new CronJob(CronExpression.EVERY_DAY_AT_MIDNIGHT, async () => {
      this.logger.warn(`start cron job sysAploInvoice`);
      const invoices = await this.invoiceRepository.getPaidInvoiceLimit(50);
      console.log(JSON.stringify(invoices));

      for (const { id } of invoices) {
        try {
          await this.invoiceSysService.registerInvoiceSysApolo(id);
        } catch (error) {
          this.logger.warn(error);
        }
      }
    });

    this.schedulerRegistry.addCronJob('sysAploInvoice', job);
    job.start();
    return job.lastDate();
  }

  async stopRegisterInvoicesSysApolo() {
    const job = this.schedulerRegistry.getCronJob('sysAploInvoice');
    job.stop();
    this.logger.warn(`stop cron job sysAploInvoice`);
    return job.lastDate();
  }
  async startRegisterInvoicesSysApolo() {
    const job = this.schedulerRegistry.getCronJob('sysAploInvoice');
    job.start();
    this.logger.warn(`start cron job sysAploInvoice`);
    return job.lastDate();
  }

  // @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  // async checkStatusInvoiceCash() {
  //   const invoices = await this.invoiceRepository.findInvoicesCash();
  //   try {
  //     for (let i = 0; i < invoices.length; i++) {
  //       const invoice = invoices[i];
  //       setTimeout(async () => {
  //         const responseBank = await getStatusInvoicePaymentWs(
  //           invoice.id.toString(),
  //         );
  //         const registerInvoice = await this.invoiceService.registerPaymentCash(
  //           responseBank,
  //           invoice,
  //         );
  //       }, i * 5000);
  //     }
  //   } catch (error) {
  //     this.logger.error(`checkStatusInvoiceCash `, error);
  //   }
  // }
}
