// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsMenu } from './SettingsMenu.tsx'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

describe('SettingsMenu', () => {
  it('is closed initially and opens the popover on click', () => {
    render(<SettingsMenu locales={['de', 'nl']} lang="de" onLang={() => {}} />)
    expect(screen.queryByRole('menu')).toBeNull()
    openMenu()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('shows the language dropdown only when locales are published', () => {
    const { rerender } = render(<SettingsMenu locales={['de']} lang="de" onLang={() => {}} />)
    openMenu()
    expect(screen.getByRole('combobox', { name: 'Display language' })).toBeInTheDocument()

    rerender(<SettingsMenu locales={[]} lang={null} onLang={() => {}} />)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('closes on Escape and on outside click', () => {
    render(
      <div>
        <button type="button">outside</button>
        <SettingsMenu locales={['de']} lang="de" onLang={() => {}} />
      </div>,
    )
    openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    openMenu()
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('applies a theme choice to <html> and persists it', () => {
    render(<SettingsMenu locales={[]} lang={null} onLang={() => {}} />)
    openMenu()
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('saezuri:theme')).toBe('dark')
  })
})
