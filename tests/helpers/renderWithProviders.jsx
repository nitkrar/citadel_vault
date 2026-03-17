/**
 * Test render helpers with common providers.
 */
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

export function renderWithRouter(ui) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}
