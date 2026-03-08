import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Shield, Check, AlertTriangle } from 'lucide-react';
import api from '../api/client';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [status, setStatus] = useState('loading'); // loading, success, error
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No verification token provided.');
      return;
    }

    api.get(`/auth.php?action=verify-email&token=${encodeURIComponent(token)}`)
      .then((res) => {
        setStatus('success');
        setMessage(res.data?.data?.message || res.data?.message || 'Email verified successfully.');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Verification failed. The link may be invalid or expired.');
      });
  }, [token]);

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: 16 }}>
          {status === 'loading' && <Shield size={48} style={{ color: '#2563eb' }} />}
          {status === 'success' && <Check size={48} style={{ color: '#10b981' }} />}
          {status === 'error' && <AlertTriangle size={48} style={{ color: '#ef4444' }} />}
        </div>

        <h2 style={{ fontSize: '1.25rem', marginBottom: 8 }}>
          {status === 'loading' && 'Verifying...'}
          {status === 'success' && 'Email Verified'}
          {status === 'error' && 'Verification Failed'}
        </h2>

        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 20 }}>
          {status === 'loading' ? 'Please wait while we verify your email address.' : message}
        </p>

        {status !== 'loading' && (
          <Link to="/login" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Go to Sign In
          </Link>
        )}
      </div>
    </div>
  );
}
