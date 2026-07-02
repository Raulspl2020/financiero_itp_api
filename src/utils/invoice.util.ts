import * as QRCode from 'qrcode';
import { generate } from 'randomstring';
import { Invoice } from 'src/modules/invoice/entities/invoice.entity';
import { EOnlinePayment } from 'src/modules/invoice/enums/invoice.enum';
import { DeepPartial } from 'typeorm';
import { IStudent } from '../interfaces/enrollment.interface';
import { IDescriptionSys, ITotales } from '../interfaces/payment.interface';
import { DetailInvoice } from '../modules/invoice/entities/detailInvoice.entity';
import { Package } from '../modules/invoice/entities/package.entity';

const normalizeRate = (value: number): number => {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const TECHNOLOGY_CREDIT_CONCEPT_ID = 33;

export const limpiarCampos = (cadena: string = '') => {
  cadena.toString().replace(/[`~!@#$%^&*¬()_|\-=?;:'",.<>\{\}\[\]\\\/]/gim, '');
};

export const generateDescriptionSys = (payload: IDescriptionSys): string => {
  const { category, datePayment, formPayment, program, transactionCode } =
    payload;

  return `${category} - ${program} - ${formPayment} - ${transactionCode} - ${datePayment}`;
};

//esto solo puede funcionar si el aumento solo corresponde a la matricula extraordinaria
export const calcularTotales = (detalle: DetailInvoice[]): ITotales => {
  const totalExtraordinario = detalle
    .map(({ valorUnidad, cantidad, aumento, descuento }) => {
      const safeDescuento = normalizeRate(Number(descuento));
      const safeAumento = Number(aumento) < 0 ? 0 : Number(aumento);
      const subtotal = valorUnidad * cantidad;
      //primero se aplica el aumento, para calcular el descuento sobre el resultado obtenido
      const subtotalDescuento = subtotal * safeDescuento;
      const subtotalAumento = subtotal * safeAumento;
      return subtotal - subtotalDescuento + subtotalAumento;
    })
    .reduce((a, b) => a + b, 0);

  const totalCompleto = detalle
    .map(({ valorUnidad, cantidad, aumento, descuento }) => {
      const safeDescuento = normalizeRate(Number(descuento));
      const safeAumento = Number(aumento) < 0 ? 0 : Number(aumento);
      const subtotal = valorUnidad * cantidad;
      //primero se aplica el aumento, para calcular el descuento sobre el resultado obtenido
      const subtotalDescuento = subtotal * safeDescuento;
      const subtotalAumento = subtotal * safeAumento;
      return subtotal - subtotalDescuento + subtotalAumento;
    })
    .reduce((a, b) => a + b, 0);

  const totalOrdinario = detalle
    .map(({ valorUnidad, cantidad, descuento }) => {
      const safeDescuento = normalizeRate(Number(descuento));
      const subtotal = valorUnidad * cantidad;
      return subtotal - subtotal * safeDescuento;
    })
    .reduce((a, b) => a + b, 0);

  return {
    totalExtraordinario,
    totalOrdinario,
    totalCompleto,
  };
};

export const calcularSubTotal = (
  detInvoice: DeepPartial<DetailInvoice>,
): number => {
  const { valorUnidad, cantidad, aumento, descuento } = detInvoice;
  const safeDescuento = normalizeRate(Number(descuento));
  const safeAumento = Number(aumento) < 0 ? 0 : Number(aumento);
  const subtotal = valorUnidad * cantidad;
  //primero se aplica el descueto
  const subtotalDescuento = subtotal * safeDescuento;
  const subtotalAumento = subtotal * safeAumento;
  return subtotal - subtotalDescuento + subtotalAumento;
};

export const llenarSubTotal = (
  detInvoice: DetailInvoice[],
): DetailInvoice[] => {
  return detInvoice.map((detail) => {
    return {
      ...detail,
      subtotal: calcularSubTotal(detail),
    };
  });
};

export const calcularTotalExtraOrdinario = (
  detInvoice: DetailInvoice[],
  paquete: Package,
): number => {
  const { packageDetail, config } = paquete;

  const concepts = packageDetail.map((det) => {
    if (det.descuentoExt == '1') {
      return det.conceptoId;
    }
  });

  const totalExtraordinario = detInvoice
    .map(({ valorUnidad, cantidad, aumento, descuento, conceptoId }) => {
      const safeDescuento = normalizeRate(Number(descuento));
      const safeAumento = Number(aumento) < 0 ? 0 : Number(aumento);
      if (concepts.some((item) => conceptoId == item)) {
        aumento = config.porcentajeExt;
      }

      const aumentoAplicado = Number(aumento) < 0 ? safeAumento : Number(aumento);

      const subtotal = valorUnidad * cantidad;
      const quantityForIncrease =
        Number(conceptoId) == TECHNOLOGY_CREDIT_CONCEPT_ID && safeDescuento >= 1
          ? 1
          : cantidad;
      //primero se aplica el aumento, para calcular el descuento sobre el resultado obtenido
      const subtotalDescuento = subtotal * safeDescuento;
      const subtotalAumento = valorUnidad * quantityForIncrease * aumentoAplicado;
      return subtotal - subtotalDescuento + subtotalAumento;
    })
    .reduce((a, b) => a + b, 0);

  return totalExtraordinario;
};

export const generateCodeInvoice = (info: IStudent): string => {
  const cadena =
    info.ape1_persona +
    info.ape2_persona +
    info.nom1_persona +
    info.nom2_persona +
    info.ide_persona;

  const newString = cadena
    .replace(/\s+/g, '')
    .replace(/[`~!@#$%^&*¬()_|\-=?;:'",.<>\{\}\[\]\\\/]/gim, '');

  return generate({
    charset: cadena,
    length: 10,
  });
};

export const generateEndDatePayment = (months: number = 1): Date => {
  const currentDate = new Date();
  const dt = new Date();
  const month = dt.getMonth() + months;
  const year = dt.getFullYear();
  const day = dt.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  currentDate.setDate(daysInMonth);
  return currentDate;
};

export const createQRBase64 = async (
  dataForQRcode: string,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    QRCode.toDataURL(
      dataForQRcode,
      { errorCorrectionLevel: 'L', type: 'image/webp' },
      (err: any, src: string) => {
        if (err) reject(err);
        resolve(src);
      },
    );
  });
};

export const isOnlinePay = (online: string | undefined) => {
  if (!online) return false;
  return online?.toString() == EOnlinePayment.SI;
};

export const llenarSubTotalSinAumento = (
  detInvoice: DetailInvoice[],
): DetailInvoice[] => {
  return detInvoice.map((detail) => {
    const { valorUnidad, cantidad, descuento } = detail;
    const safeDescuento = normalizeRate(Number(descuento));
    const subtotal = valorUnidad * cantidad;
    const subtotalDescuento = subtotal * safeDescuento;

    return {
      ...detail,
      descuento: safeDescuento,
      subtotal: subtotal - subtotalDescuento,
    };
  });
};

export const hasPaymentInvoice = (invoice: Invoice): boolean => {
  try {
    const { detailPayments, detailInvoices } = invoice;

    const { totalCompleto = 0 } = calcularTotales(detailInvoices);
    const totalPagado = detailPayments
      .filter(({ estadoPagoId }) => estadoPagoId == 1)
      .map((pago) => pago.totalPago)
      .reduce((a, b) => a + b, 0);

    return totalPagado >= totalCompleto;
  } catch (error) {
    console.log(error);
    return false;
  }
};
