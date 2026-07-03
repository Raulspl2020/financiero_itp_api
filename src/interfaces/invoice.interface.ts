import StreamTransport from 'nodemailer/lib/stream-transport';
import { Discounts } from 'src/modules/invoice/entities/discounts.entity';
import { PackageDetail } from 'src/modules/invoice/entities/packageDetail.entity';
import { UniversityPeriod } from 'src/modules/invoice/entities/univsityPeriod.entity';
import { IInfoInvoice, IStudent } from './enrollment.interface';

export interface IGenerateInvoice {
  codPaquete: string;
  matriculaId?: number;
  categoriaPagoId: number;
  total: number;
  isPagoOnline: boolean;
  infoEstudiante: IStudent;
  cantidad?: number;
  conceptoId?: number;
  descripcion?: string;
}

export interface IInvicePdfParams {
  barcodeOrd: string;
  barcodeExt?: string;
  infoStudent: IStudent;
  discounts?: Discounts[];
  period?: {
    fecIniInsNuevos: Date;
    fecFinInsNuevos: Date;
    fechaInicioMatricula: Date;
    fechaFinMatricula: Date;
    fechaInicioMatriculaExt: Date;
    fechaFinMatriculaExt: Date;
  };
  totalOrdinario: number;
  totalExtraordinario?: number;
  qrBase64?: string;
  generated?: Date;
  limitDate?: Date;
  BASE_URL?: string;
  hasPayment?: boolean;
}

export interface IInvoiceResponse {
  redirectPayment: string | null;
  error: boolean;
  message: string;
  invoiceId?: number;
}

export interface ICreateDetailInvoice {
  packageDetail: PackageDetail[];
  aumentoExtra?: number;
  descuentoExtra?: number;
  quantity?: number;
  categoriaId?: number;
  total?: number;
}
