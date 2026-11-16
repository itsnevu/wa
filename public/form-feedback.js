(() => {
  const errors = new WeakMap();
  let nextId = 0;
  function message(field) {
    const name = (field.getAttribute('aria-label') || field.labels?.[0]?.childNodes[0]?.textContent || field.placeholder || 'kolom ini').trim().toLocaleLowerCase('id');
    const blank = field.required && (['text','search','email','url','tel'].includes(field.type) || field.tagName === 'TEXTAREA') && !field.value.trim();
    if (field.validity.valueMissing || blank) return `Isi ${name} terlebih dahulu.`;
    if (field.validity.tooShort || (field.value && field.minLength > 0 && field.value.length < field.minLength)) return `Gunakan minimal ${field.minLength} karakter.`;
    if (field.validity.typeMismatch) return `Format ${name} belum sesuai.`;
    if (field.validity.patternMismatch) return `Periksa kembali format ${name}.`;
    if (field.validity.rangeUnderflow) return `Nilai minimal ${field.min}.`;
    if (field.validity.rangeOverflow) return `Nilai maksimal ${field.max}.`;
    return field.validity.valid ? '' : 'Periksa kembali isi kolom ini.';
  }
  function feedback(field) {
    const text = message(field);
    let error = errors.get(field);
    if (!text) {
      field.removeAttribute('aria-invalid');
      if (error) error.hidden = true;
      return true;
    }
    if (!error) {
      error = document.createElement('small');
      error.id = `fieldFeedback${++nextId}`;
      error.className = 'field-feedback';
      error.setAttribute('role','alert');
      field.after(error);
      field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
      errors.set(field,error);
    }
    if (error.textContent !== text) error.textContent = text;
    error.hidden = false;
    field.setAttribute('aria-invalid','true');
    return false;
  }
  function scan() { document.querySelectorAll('form').forEach(form => { form.noValidate = true; }); }
  document.addEventListener('submit', event => {
    const form = event.target;
    let first = null;
    [...form.elements].filter(field => field.willValidate).forEach(field => { if (!feedback(field) && !first) first = field; });
    if (!first) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    (first.classList.contains('enhanced-select') ? document.getElementById(`${first.id}Trigger`) : first)?.focus();
  },true);
  document.addEventListener('invalid',event => { event.preventDefault(); feedback(event.target); },true);
  for (const type of ['input','change']) document.addEventListener(type,event => { if (errors.has(event.target)) feedback(event.target); });
  scan();
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
})();
