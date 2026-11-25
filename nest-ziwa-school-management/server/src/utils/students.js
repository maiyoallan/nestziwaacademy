import { STUDENT_CLASSES, STUDENT_SECTIONS, STUDENT_STATUSES } from '../config/modules.js';

export function normalizeStudentData(data = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(data)) {
    normalized[key.trim()] = typeof value === 'string' && /name|^(class|section|status|admission number)$/i.test(key.trim())
      ? value.trim().toUpperCase()
      : value;
  }
  return normalized;
}

export function validateStudentData(data = {}) {
  const errors = [];
  if (!data['Full name']?.trim()) errors.push('Full name is required.');
  if (!STUDENT_CLASSES.includes(data.Class)) errors.push(`Class must be one of: ${STUDENT_CLASSES.join(', ')}.`);
  if (!STUDENT_SECTIONS.includes(data.Section)) errors.push(`Section must be one of: ${STUDENT_SECTIONS.join(', ')}.`);
  if (!STUDENT_STATUSES.includes(data.Status)) errors.push(`Status must be one of: ${STUDENT_STATUSES.join(', ')}.`);
  if (data['Date of birth'] && !/^\d{4}-\d{2}-\d{2}$/.test(String(data['Date of birth']))) errors.push('Date of birth must use YYYY-MM-DD.');
  if (data['Date of birth']) {
    const date = new Date(`${data['Date of birth']}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== data['Date of birth']) errors.push('Date of birth is not a valid date.');
  }
  return errors;
}
