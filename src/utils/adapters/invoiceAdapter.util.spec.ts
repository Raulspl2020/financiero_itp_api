import { createDetailInvoice } from './invoiceAdapter.util';

const packageDetail = (conceptoId: number, descuentoExt = '0'): any => [
  {
    conceptoId,
    descuentoExt,
    aumento: 0,
    descuento: 0,
    valorUnidad: 4500000,
    cantidad: 1,
    concept: { descripcion: 'CONCEPTO FICTICIO' },
  },
];

describe('createDetailInvoice', () => {
  it('aplica descuento externo autorizado a concepto de matricula de especializacion', () => {
    const [detail] = createDetailInvoice({
      packageDetail: packageDetail(64),
      descuentoExtra: 0.1 + 0.05,
      applyExternalDiscounts: true,
      externalDiscountConceptIds: [52, 64],
    });

    expect(detail.descuento).toBe(0.15);
    expect(Number(detail.valorUnidad) * Number(detail.descuento)).toBe(675000);
    expect(detail.subtotal).toBe(3825000);
  });

  it('no habilita descuento externo cuando applyExternalDiscounts es false', () => {
    const [detail] = createDetailInvoice({
      packageDetail: packageDetail(64),
      descuentoExtra: 0.15,
      applyExternalDiscounts: false,
      externalDiscountConceptIds: [52, 64],
    });

    expect(detail.descuento).toBe(0);
    expect(detail.subtotal).toBe(4500000);
  });

  it('no aplica descuento externo a concepto diferente de matricula', () => {
    const [detail] = createDetailInvoice({
      packageDetail: packageDetail(4),
      descuentoExtra: 0.15,
      applyExternalDiscounts: true,
      externalDiscountConceptIds: [52, 64],
    });

    expect(detail.descuento).toBe(0);
    expect(detail.subtotal).toBe(4500000);
  });

  it('applyExternalDiscounts no autoriza aumentoExtra', () => {
    const [detail] = createDetailInvoice({
      packageDetail: packageDetail(64),
      descuentoExtra: 0.15,
      aumentoExtra: 0.2,
      applyExternalDiscounts: true,
      externalDiscountConceptIds: [52, 64],
    });

    expect(detail.descuento).toBe(0.15);
    expect(detail.aumento).toBe(0);
    expect(detail.subtotal).toBe(3825000);
  });

  it('sin descuento autorizado conserva valor completo', () => {
    const [detail] = createDetailInvoice({
      packageDetail: packageDetail(64),
      descuentoExtra: 0,
      applyExternalDiscounts: true,
      externalDiscountConceptIds: [52, 64],
    });

    expect(detail.descuento).toBe(0);
    expect(detail.subtotal).toBe(4500000);
  });
});
