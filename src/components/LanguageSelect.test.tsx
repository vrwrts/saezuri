// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LanguageSelect } from './LanguageSelect.tsx'

describe('LanguageSelect', () => {
  it('renders an endonym option per published locale', () => {
    render(<LanguageSelect locales={['de', 'nl']} value="de" onChange={() => {}} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const labels = Array.from(select.options).map((o) => o.textContent)
    // Intl.DisplayNames endonyms: German "Deutsch", Dutch "Nederlands".
    expect(labels).toEqual(['Deutsch', 'Nederlands'])
    expect(select.value).toBe('de')
  })

  it('fires onChange with the chosen locale', () => {
    const onChange = vi.fn()
    render(<LanguageSelect locales={['de', 'nl']} value="de" onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nl' } })
    expect(onChange).toHaveBeenCalledWith('nl')
  })

  it('renders nothing when no locales are published', () => {
    const { container } = render(<LanguageSelect locales={[]} value={null} onChange={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})
