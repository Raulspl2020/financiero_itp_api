import { ICreateDetailInvoice } from '../../interfaces/invoice.interface';
import { ECategoryInvoice } from '../../modules/invoice/enums/invoice.enum';
import { DeepPartial } from 'typeorm';
import { DetailInvoice } from '../../modules/invoice/entities/detailInvoice.entity';
import { calcularSubTotal } from '../invoice.util';

const RATE_DECIMAL_FACTOR = 1000000;

const clampRate = (value: number): number => {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * RATE_DECIMAL_FACTOR) / RATE_DECIMAL_FACTOR;
};

export const INDIVIDUAL_CREDIT_CONCEPT_IDS = [33, 35];

export const createDetailInvoice = ({
  packageDetail,
  aumentoExtra = 0,
  descuentoExtra = 0,
  quantity = 1,
  total = 0,
  categoriaId = 0,
  applyExternalDiscounts = false,
  externalDiscountConceptIds = [],
}: ICreateDetailInvoice) => {
  return packageDetail
    .map<DeepPartial<DetailInvoice>>((detail) => {
      const { aumento, conceptoId, descuento, valorUnidad, cantidad } = detail;
      let detailQuantity = quantity;

      if (categoriaId == ECategoryInvoice.MATRICULA) {
        // solo se usa la cantidad enviada si son conceptos de creditos individuales
        if (!INDIVIDUAL_CREDIT_CONCEPT_IDS.includes(Number(conceptoId))) {
          detailQuantity = cantidad;
        }
      }

      const shouldApplyExternalDiscount =
        detail.descuentoExt == '1' ||
        (applyExternalDiscounts &&
          externalDiscountConceptIds.includes(Number(conceptoId)));
      const shouldApplyExternalIncrease = detail.descuentoExt == '1';

      return {
        conceptoId,
        valorUnidad: total > 0 ? total : valorUnidad,
        concept: detail.concept,
        aumento: shouldApplyExternalIncrease ? aumentoExtra + aumento : aumento,
        cantidad: Number(detailQuantity < 1 ? 1 : detailQuantity),
        descuento: clampRate(
          Number(shouldApplyExternalDiscount ? descuentoExtra + descuento : descuento),
        ),
      };
    })
    .map((detail) => {
      return {
        ...detail,
        subtotal: calcularSubTotal(detail),
      };
    });
};
