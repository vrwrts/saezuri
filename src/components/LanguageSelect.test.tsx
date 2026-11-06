// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LanguageSelect } from './LanguageSelect.tsx'

describe('LanguageSelect', () => {
  it('renders station and an endonym for each published locale', () => {
    render(<LanguageSelect locales={['de', 'nl']} value="de" onChange={() => {}} />)

    const select = screen.getByRole('combobox') as HTMLSelectElement
    const labels = Array.from(select.options).map((o) => o.textContent)

    // Intl.DisplayNames endonyms: German "Deutsch", Dutch "Nederlands".
    expect(labels).toEqual(['Station language', 'Deutsch', 'Nederlands'])
    expect(select.value).toBe('de')
  })

  it('fires onChange with the chosen dictionary locale', () => {
    const onChange = vi.fn()
    render(<LanguageSelect locales={['de', 'nl']} value="de" onChange={onChange} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nl' } })

    expect(onChange).toHaveBeenCalledWith('nl')
  })

  it('fires onChange when station language is selected', () => {
    const onChange = vi.fn()
    render(<LanguageSelect locales={['de', 'nl']} value="de" onChange={onChange} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'station' } })

    expect(onChange).toHaveBeenCalledWith('station')
  })

  it('renders nothing when no dictionaries are published', () => {
    render(<LanguageSelect locales={[]} value="station" onChange={() => {}} />)

    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
