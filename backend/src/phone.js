// South African cellphone numbers, the way customers type them: "082 123 4567",
// "0821234567", "+27 82 123 4567" or "27821234567" all mean the same number.
// Stored and compared in the ten-digit local form, 0821234567.

function normalizePhone(value) {
  if (value == null) return null;
  let digits = String(value).replace(/[^\d+]/g, '');
  if (digits.startsWith('+27')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('27') && digits.length === 11) digits = `0${digits.slice(2)}`;
  digits = digits.replace(/\D/g, '');
  return /^0\d{9}$/.test(digits) ? digits : null;
}

// Does this look like someone typed a phone number rather than an email?
function looksLikePhone(value) {
  return /^[\s()+\d-]+$/.test(String(value || '').trim()) && /\d{9}/.test(String(value).replace(/\D/g, ''));
}

module.exports = { normalizePhone, looksLikePhone };
