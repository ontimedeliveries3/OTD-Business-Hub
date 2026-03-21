import { useState, useEffect } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider } from '../lib/firebase'
import { AuthContext } from './auth-context'

const ALLOWED_EMAILS = [
  'ontimedeliveries3@gmail.com',
  'mohitsingh87@gmail.com',
]

const SUPER_ADMIN_EMAIL = 'mohitsingh87@gmail.com'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser && ALLOWED_EMAILS.includes(firebaseUser.email)) {
        setUser(firebaseUser)
        setError(null)
      } else if (firebaseUser) {
        // Signed in but not allowed — sign them out
        signOut(auth)
        setUser(null)
        setError('Access denied. Your email is not authorized.')
      } else {
        setUser(null)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const login = async () => {
    try {
      setError(null)
      const result = await signInWithPopup(auth, googleProvider)
      if (!ALLOWED_EMAILS.includes(result.user.email)) {
        await signOut(auth)
        setError('Access denied. Your email is not authorized.')
      }
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message)
      }
    }
  }

  const logout = async () => {
    await signOut(auth)
    setUser(null)
  }

  const isSuperAdmin = user?.email === SUPER_ADMIN_EMAIL

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout, isSuperAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}
