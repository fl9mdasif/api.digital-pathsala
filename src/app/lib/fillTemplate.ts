/**
 * Fills `{placeholder}` markers in a template (a QR payload, a certificate body, a card note).
 * A name that has no value becomes an empty string, so a missing detail never prints "undefined".
 */
export const fillTemplate = (template: string, values: Record<string, string | number | null | undefined>): string =>
  template.replace(/\{([a-z_]+)\}/gi, (_m, key: string) => {
    const v = values[key.toLowerCase()];
    return v === null || v === undefined ? '' : String(v);
  });

/** The placeholder names a template may use, so the settings page can offer them as click-to-insert badges. */
export const STUDENT_PLACEHOLDERS = [
  'student_id',
  'name',
  'roll',
  'class_name',
  'section_name',
  'group_name',
  'session',
  'father_name',
  'mother_name',
  'mobile',
  'blood_group',
  'dob',
] as const;
