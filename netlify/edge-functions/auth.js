import { handleLogin, handleLogout } from '../lib/_auth.js'

export default async (req, _context) => {
  const url = new URL(req.url)

  try {
    if (url.pathname.endsWith('/login')) {
      return await handleLogin(req)
    }

    if (url.pathname.endsWith('/logout')) {
      return handleLogout(req)
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Unexpected error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
