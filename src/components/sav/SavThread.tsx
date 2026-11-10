import React, { useEffect, useRef, useState } from 'react';
import { FileText, ImagePlus, Lock, Loader2, Paperclip, Send, X } from 'lucide-react';
import { ImageLightbox } from '../ui/ImageLightbox';
import {
  SavAttachment,
  SAV_MAX_FILES,
  formatSavDate,
  signSavAttachments,
} from '../../lib/sav';

/**
 * Fil d'un ticket SAV, partagé entre l'admin (viewer = 'team' : notes
 * internes en jaune) et « Mes demandes » (viewer = 'client' : les notes
 * internes ne lui parviennent jamais, filtrées par la vue sav_my_ticket_messages).
 */

export interface SavThreadMessage {
  id: string;
  author_type: 'client' | 'team' | 'system';
  author_name: string;
  content: string;
  attachments: SavAttachment[];
  created_at: string;
  internal?: boolean;
}

const isImage = (a: SavAttachment) => a.type.startsWith('image/') && a.type !== 'image/heic';

export const SavAttachmentList: React.FC<{ attachments: SavAttachment[]; urls: Record<string, string> }> = ({ attachments, urls }) => {
  const images = attachments.filter(isImage);
  const others = attachments.filter((a) => !isImage(a));
  const [lightbox, setLightbox] = useState<number | null>(null);
  const imageUrls = images.map((a) => urls[a.path]).filter(Boolean);

  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a, i) =>
            urls[a.path] ? (
              <button key={a.path} type="button" onClick={() => setLightbox(i)} className="block">
                <img src={urls[a.path]} alt={a.name} className="h-20 w-20 rounded-lg border border-gray-200 object-cover hover:opacity-90" />
              </button>
            ) : (
              <div key={a.path} className="h-20 w-20 animate-pulse rounded-lg bg-gray-100" />
            )
          )}
        </div>
      )}
      {others.map((a) => (
        <a
          key={a.path}
          href={urls[a.path]}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
        >
          <FileText className="h-4 w-4 text-gray-400" />
          <span className="truncate">{a.name}</span>
        </a>
      ))}
      {lightbox !== null && imageUrls.length > 0 && (
        <ImageLightbox images={imageUrls} index={lightbox} onIndexChange={setLightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
};

/** Liens signés des pièces jointes d'une liste de messages. */
export const useSignedAttachmentUrls = (messages: { attachments: SavAttachment[] }[]) => {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = messages.flatMap((m) => m.attachments.map((a) => a.path)).join('|');
  useEffect(() => {
    const paths = key ? key.split('|') : [];
    if (paths.length === 0) return;
    let cancelled = false;
    signSavAttachments(paths).then((map) => {
      if (!cancelled) setUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return urls;
};

export const SavThread: React.FC<{ messages: SavThreadMessage[]; viewer: 'team' | 'client' }> = ({ messages, viewer }) => {
  const urls = useSignedAttachmentUrls(messages);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  if (messages.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">Aucun message pour l'instant.</p>;
  }

  return (
    <div className="space-y-4">
      {messages.map((m) => {
        if (m.author_type === 'system') {
          return (
            <div key={m.id} className="text-center text-xs text-gray-400">
              {m.content} · {formatSavDate(m.created_at)}
            </div>
          );
        }
        const mine = viewer === 'team' ? m.author_type === 'team' : m.author_type === 'client';
        const bubble = m.internal
          ? 'bg-amber-50 border border-amber-200 text-gray-900'
          : mine
            ? 'bg-gray-900 text-white'
            : 'bg-white border border-gray-200 text-gray-900';
        return (
          <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%] sm:max-w-[75%]">
              <div className={`mb-1 flex items-center gap-1.5 text-xs text-gray-500 ${mine ? 'justify-end' : ''}`}>
                {m.internal && <Lock className="h-3 w-3 text-amber-600" />}
                <span className="font-medium text-gray-700">{m.internal ? `Note interne · ${m.author_name}` : m.author_name}</span>
                <span>· {formatSavDate(m.created_at)}</span>
              </div>
              <div className={`rounded-2xl px-4 py-3 text-sm ${bubble}`}>
                {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                <SavAttachmentList attachments={m.attachments} urls={urls} />
              </div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
};

/** Sélecteur de fichiers (photos / PDF) avec aperçu des noms. */
export const SavFilePicker: React.FC<{ files: File[]; onChange: (files: File[]) => void; disabled?: boolean }> = ({ files, onChange, disabled }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files || []);
          onChange([...files, ...picked].slice(0, SAV_MAX_FILES));
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={disabled || files.length >= SAV_MAX_FILES}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        <ImagePlus className="h-4 w-4" />
        Ajouter des photos
      </button>
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
          <Paperclip className="h-3 w-3" />
          <span className="max-w-[140px] truncate">{f.name}</span>
          <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} className="text-gray-400 hover:text-gray-700">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
};

/** Zone de réponse : texte + photos + bouton d'envoi. */
export const SavReplyBox: React.FC<{
  placeholder: string;
  submitLabel: string;
  onSubmit: (text: string, files: File[]) => Promise<void>;
  value?: string;
  onValueChange?: (v: string) => void;
  extra?: React.ReactNode;
  tone?: 'default' | 'internal';
  disabled?: boolean;
}> = ({ placeholder, submitLabel, onSubmit, value, onValueChange, extra, tone = 'default', disabled }) => {
  const [local, setLocal] = useState('');
  const text = value ?? local;
  const setText = onValueChange ?? setLocal;
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!text.trim() && files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim(), files);
      setText('');
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl border p-3 ${tone === 'internal' ? 'border-amber-200 bg-amber-50/60' : 'border-gray-200 bg-white'}`}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={4}
        maxLength={5000}
        disabled={disabled || busy}
        className="w-full resize-y rounded-lg border-0 bg-transparent p-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <SavFilePicker files={files} onChange={setFiles} disabled={disabled || busy} />
        <div className="flex items-center gap-2">
          {extra}
          <button
            type="button"
            onClick={submit}
            disabled={disabled || busy || (!text.trim() && files.length === 0)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitLabel}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
};
