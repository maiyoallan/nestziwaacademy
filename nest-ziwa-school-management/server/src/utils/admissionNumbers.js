export const ADMISSION_NUMBER_FIELD = 'Admission number';

export function getAdmissionNumber(data = {}) {
  if (!data || typeof data !== 'object') return '';
  const key = Object.keys(data).find((field) => field.trim().toLowerCase() === ADMISSION_NUMBER_FIELD.toLowerCase());
  return key ? String(data[key] ?? '').trim() : '';
}

export function normalizeAdmissionNumber(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
}

export function nextAdmissionNumber(values, year = new Date().getFullYear()) {
  const pattern = new RegExp(`^NZS-${year}-(\\d+)$`, 'i');
  const highest = values.reduce((max, value) => {
    const match = normalizeAdmissionNumber(value).match(pattern);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `NZS-${year}-${String(highest + 1).padStart(4, '0')}`;
}
