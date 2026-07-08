// Vitest global setup. jsdom-environment tests get jest-dom matchers; pure
// node tests import this harmlessly (the matchers just register on expect).
import '@testing-library/jest-dom/vitest'
