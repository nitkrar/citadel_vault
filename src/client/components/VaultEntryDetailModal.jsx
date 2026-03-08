import { useState, useEffect } from 'react';
import Modal from './Modal';
import DetailField from './DetailField';
import api from '../api/client';
import { dbBool, apiData } from '../lib/checks';
import { Eye, EyeOff, Copy, Check, Edit2, Star } from 'lucide-react';

export default function VaultEntryDetailModal({ isOpen, onClose, item, onEdit }) {
  const [fullData, setFullData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState('');

  useEffect(() => {
    if (isOpen && item?.id) {
      setFullData(null);
      setShowPassword(false);
      setCopiedField('');
      setLoading(true);
      api.get(`/vault.php?id=${item.id}`)
        .then(res => setFullData(apiData(res, item)))
        .catch(() => setFullData(item))
        .finally(() => setLoading(false));
    }
  }, [isOpen, item?.id]);

  const copyToClipboard = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(''), 1500);
    } catch {}
  };

  const entry = fullData || item;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Vault Entry"
      size="lg"
      footer={
        onEdit && entry ? (
          <button className="btn btn-primary" onClick={() => { onClose(); onEdit(entry); }}>
            <Edit2 size={14} /> Edit Entry
          </button>
        ) : null
      }
    >
      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : entry ? (
        <div className="flex flex-col gap-3">
          <DetailField label="Title" large>
            {entry.title}
            {dbBool(entry.is_favourite) && (
              <Star size={16} fill="#f59e0b" color="#f59e0b" style={{ marginLeft: 8, verticalAlign: 'middle' }} />
            )}
          </DetailField>

          {entry.website_url && (
            <DetailField label="Website">
              <a href={entry.website_url} target="_blank" rel="noopener noreferrer">{entry.website_url}</a>
            </DetailField>
          )}

          {entry.username && (
            <DetailField label="Username">
              <div className="flex items-center gap-2">
                <span className="font-mono">{entry.username}</span>
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => copyToClipboard(entry.username, 'username')}
                  title="Copy username"
                >
                  {copiedField === 'username' ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                </button>
              </div>
            </DetailField>
          )}

          <DetailField label="Password">
            <div className="flex items-center gap-2">
              <span className="font-mono">{showPassword ? (entry.password || '--') : '\u2022'.repeat(16)}</span>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setShowPassword(p => !p)}
                title={showPassword ? 'Hide' : 'Show'}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              {entry.password && (
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => copyToClipboard(entry.password, 'password')}
                  title="Copy password"
                >
                  {copiedField === 'password' ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                </button>
              )}
            </div>
          </DetailField>

          {entry.category && (
            <DetailField label="Category">
              <span className="badge badge-primary">{entry.category}</span>
            </DetailField>
          )}

          {entry.notes && <DetailField label="Notes" value={entry.notes} pre />}
        </div>
      ) : null}
    </Modal>
  );
}
