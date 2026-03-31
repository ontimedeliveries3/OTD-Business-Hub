import { useState, useEffect } from 'react'

// Converts ISO "2026-03-29" → display "29/03/2026"
function isoToDisplay(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return ''
  return `${d}/${m}/${y}`
}

// Converts display "29/03/2026" → ISO "2026-03-29"
function displayToIso(display) {
  if (!display) return ''
  const [d, m, y] = display.split('/')
  if (!d || !m || !y || y.length !== 4) return ''
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// Auto-formats as user types: adds slashes after DD and MM
function autoFormat(raw) {
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`
}

export default function DateInput({ value, onChange, className = '', placeholder = 'DD/MM/YYYY', ...props }) {
  const [display, setDisplay] = useState(() => isoToDisplay(value))

  // Sync when external value changes
  useEffect(() => {
    setDisplay(isoToDisplay(value))
  }, [value])

  const handleChange = (e) => {
    const formatted = autoFormat(e.target.value)
    setDisplay(formatted)

    // Only emit onChange when we have a complete valid date
    if (formatted.length === 10) {
      const iso = displayToIso(formatted)
      if (iso && iso.length === 10) {
        onChange?.(iso)
      }
    } else if (formatted === '') {
      onChange?.('')
    }
  }

  const handleBlur = () => {
    // On blur, try to parse partial input
    if (display && display.length === 10) {
      const iso = displayToIso(display)
      if (iso) onChange?.(iso)
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      maxLength={10}
      className={className}
      {...props}
    />
  )
}
