import { ICreateDetailInvoice } from 'src/interfaces/invoice.interface';
import { ECategoryInvoice } from 'src/modules/invoice/enums/invoice.enum';
import { DeepPartial } from 'typeorm';
import { DetailInvoice } from '../../modules/invoice/entities/detailInvoice.entity';
import { calcularSubTotal } from '../invoice.util';

const clampRate = (value: number): number => {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const INDIVIDUAL_CREDIT_CONCEPT_IDS = [1, 2, 33];

export const createDetailInvoice = ({
  packageDetail,
  aumentoExtra = 0,
  descuentoExtra = 0,
  quantity = 1,
  total = 0,
  categoriaId = 0,
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

      return {
        conceptoId,
        valorUnidad: total > 0 ? total : valorUnidad,
        concept: detail.concept,
        aumento: detail.descuentoExt == '1' ? aumentoExtra + aumento : aumento,
        cantidad: Number(detailQuantity < 1 ? 1 : detailQuantity),
        descuento: clampRate(
          Number(detail.descuentoExt == '1' ? descuentoExtra + descuento : descuento),
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
