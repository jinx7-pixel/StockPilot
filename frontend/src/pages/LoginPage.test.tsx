import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthProvider';
import { ProtectedRoute, PublicOnlyRoute } from '../auth/ProtectedRoute';
import { LoginPage } from './LoginPage';

afterEach(() => vi.unstubAllGlobals());

it('stays on sign-in until a matching workspace is selected', async () => {
  const first = { id: 'workspace-1', name: 'Northside Supply' };
  const second = { id: 'workspace-2', name: 'Riverside Supply' };
  const fetchAuth = vi.fn(async (path: string, options?: RequestInit) => {
    if (path === '/api/auth/me') return Response.json({}, { status: 401 });
    if (path !== '/api/auth/login') throw new Error(`Unexpected request: ${path}`);

    const input = JSON.parse(String(options?.body));
    if (input.workspaceId === undefined) {
      return Response.json({ data: { workspaces: [first, second] } });
    }

    expect(input).toEqual({
      email: 'owner@example.com',
      password: 'example-test-password',
      workspaceId: second.id,
    });
    return Response.json({ data: { user: {
      id: 'owner-2', name: 'Sample Owner', role: 'owner', email: input.email,
      businessId: second.id, business: second,
    } } });
  });
  vi.stubGlobal('fetch', fetchAuth);

  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/app" element={<h1>Workspace dashboard</h1>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), 'owner@example.com');
  await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'example-test-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  const workspace = await screen.findByRole('combobox', { name: 'Workspace' });
  expect(workspace).toHaveValue('');
  expect(screen.queryByRole('heading', { name: 'Workspace dashboard' })).not.toBeInTheDocument();
  await user.selectOptions(workspace, 'Riverside Supply');
  await user.click(screen.getByRole('button', { name: 'Open workspace' }));

  expect(await screen.findByRole('heading', { name: 'Workspace dashboard' })).toBeInTheDocument();
});
