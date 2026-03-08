import { useState, useCallback } from 'react';
import api from '../api/client';
import useDraft from './useDraft';

/**
 * useCrudModal — shared CRUD modal state management.
 *
 * Bundles the 6 state declarations repeated across entity pages:
 *   showModal, editItem, formError, saving (useState)
 *   form, setForm, clearDraft, confirmClear (useDraft)
 *   detailItem (useState)
 *
 * @param {string} draftKey   localStorage key for useDraft
 * @param {object} emptyForm  default form shape
 */
export default function useCrudModal(draftKey, emptyForm) {
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm, clearDraft, confirmClear] = useDraft(draftKey, emptyForm);
  const [detailItem, setDetailItem] = useState(null);

  const openAdd = useCallback(() => {
    setEditItem(null);
    setFormError('');
    setShowModal(true);
  }, []);

  const openEdit = useCallback((item, mapFn) => {
    setEditItem(item);
    setForm(mapFn(item));
    setFormError('');
    setShowModal(true);
  }, [setForm]);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditItem(null);
    setFormError('');
  }, []);

  const handleCancel = useCallback(() => {
    if (confirmClear()) closeModal();
  }, [confirmClear, closeModal]);

  const setField = useCallback((key, val) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  }, [setForm]);

  const saveEntity = useCallback(async ({ endpoint, buildPayload, validate, refetch }) => {
    setFormError('');
    const error = validate?.(form);
    if (error) { setFormError(error); return; }
    const payload = buildPayload(form);
    setSaving(true);
    try {
      if (editItem) {
        await api.put(`${endpoint}?id=${editItem.id}`, payload);
      } else {
        await api.post(endpoint, payload);
      }
      clearDraft();
      await refetch();
      closeModal();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [form, editItem, clearDraft, closeModal]);

  const deleteEntity = useCallback(async ({ endpoint, item, nameField = 'name', refetch }) => {
    const name = item[nameField] || 'this item';
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`${endpoint}?id=${item.id}`);
      await refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed.');
    }
  }, []);

  return {
    // State
    showModal, form, setForm, formError, setFormError,
    editItem, saving, setSaving, detailItem, setDetailItem,

    // Actions
    openAdd,
    openEdit,
    closeModal,
    handleCancel,
    clearDraft,
    setField,

    // CRUD helpers
    saveEntity,
    deleteEntity,
  };
}
