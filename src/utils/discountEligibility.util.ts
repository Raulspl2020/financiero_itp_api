const GRATUITY_DISCOUNT_CATEGORY_ID = 13;
const GRATUITY_INELIGIBLE_LEVEL_CODES = new Set([11, 16]);

export const INVOICE_PAYMENT_MODE = {
  INDIVIDUAL_CREDIT_PAYMENT: 'INDIVIDUAL_CREDIT_PAYMENT',
  FULL_ENROLLMENT_PAYMENT: 'FULL_ENROLLMENT_PAYMENT',
} as const;

export type InvoicePaymentMode =
  (typeof INVOICE_PAYMENT_MODE)[keyof typeof INVOICE_PAYMENT_MODE];

export const isGratuityDiscount = (discount: any): boolean => {
  const categoryId = Number(discount?.porcentajeCategoriaId);
  if (categoryId === GRATUITY_DISCOUNT_CATEGORY_ID) return true;

  return (
    String(discount?.discountCategory?.descripcion || '')
      .trim()
      .toUpperCase() === 'POLITICA DE GRATUIDAD'
  );
};

export const isDiscountApplicableToEnrollment = (
  discount: any,
  enrollment: any,
): boolean => {
  const currentEnrollmentId = Number(enrollment?.cod_matricula);
  const discountEnrollmentId = Number(discount?.matriculaId);

  if (
    Number.isFinite(discountEnrollmentId) &&
    discountEnrollmentId > 0 &&
    discountEnrollmentId !== currentEnrollmentId
  ) {
    return false;
  }

  // Legacy gratuity without matricula_id must still obey institutional eligibility rules.
  if (
    isGratuityDiscount(discount) &&
    GRATUITY_INELIGIBLE_LEVEL_CODES.has(Number(enrollment?.cod_nivel_edu))
  ) {
    return false;
  }

  return true;
};

export const filterDiscountsForEnrollment = (
  discounts: any[],
  enrollment: any,
): any[] => {
  return (discounts || []).filter((discount) =>
    isDiscountApplicableToEnrollment(discount, enrollment),
  );
};

const getDiscountCategoryId = (discount: any): number => {
  const categoryId = Number(
    discount?.porcentajeCategoriaId ?? discount?.porcentaje_categoria_id,
  );
  return Number.isFinite(categoryId) ? categoryId : 0;
};

const getDiscountId = (discount: any): number => {
  const id = Number(discount?.id ?? discount?._id);
  return Number.isFinite(id) ? id : 0;
};

const getDiscountTime = (discount: any, field: string): number => {
  const value = discount?.[field];
  if (!value) return 0;

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const shouldReplaceDiscount = (current: any, candidate: any): boolean => {
  const currentUpdatedAt = getDiscountTime(current, 'fechaUpdate');
  const candidateUpdatedAt = getDiscountTime(candidate, 'fechaUpdate');
  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt;
  }

  const currentCreatedAt = getDiscountTime(current, 'fecha');
  const candidateCreatedAt = getDiscountTime(candidate, 'fecha');
  if (candidateCreatedAt !== currentCreatedAt) {
    return candidateCreatedAt > currentCreatedAt;
  }

  return getDiscountId(candidate) > getDiscountId(current);
};

export const deduplicateDiscountsByCategory = (discounts: any[]): any[] => {
  const selectedByCategory = new Map<number, any>();
  const withoutCategory: any[] = [];

  (discounts || []).forEach((discount) => {
    const categoryId = getDiscountCategoryId(discount);
    if (categoryId <= 0) {
      withoutCategory.push(discount);
      return;
    }

    const current = selectedByCategory.get(categoryId);
    if (!current || shouldReplaceDiscount(current, discount)) {
      selectedByCategory.set(categoryId, discount);
    }
  });

  return [...selectedByCategory.values(), ...withoutCategory];
};

export const resolveEnrollmentPaymentMode = (
  creditCount: any,
  minimumCredits: any,
): InvoicePaymentMode => {
  const credits = Number(creditCount);
  const minCredits = Number(minimumCredits);

  if (
    Number.isFinite(credits) &&
    Number.isFinite(minCredits) &&
    credits > 0 &&
    credits <= minCredits
  ) {
    return INVOICE_PAYMENT_MODE.INDIVIDUAL_CREDIT_PAYMENT;
  }

  return INVOICE_PAYMENT_MODE.FULL_ENROLLMENT_PAYMENT;
};

export const filterDiscountsForInvoiceMode = (
  discounts: any[],
  paymentMode: InvoicePaymentMode,
): any[] => {
  if (paymentMode !== INVOICE_PAYMENT_MODE.INDIVIDUAL_CREDIT_PAYMENT) {
    return discounts || [];
  }

  return (discounts || []).filter((discount) => isGratuityDiscount(discount));
};
