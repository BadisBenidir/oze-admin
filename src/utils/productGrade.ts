export const GRADE_VARIANTS: Record<string, 'success' | 'info' | 'warning' | 'default'> = {
  S: 'success',
  A: 'success',
  AB: 'info',
  B: 'info',
  BC: 'warning',
  C: 'warning',
  D: 'default',
};

export const isGrade = (condition: string) => Object.prototype.hasOwnProperty.call(GRADE_VARIANTS, condition);
