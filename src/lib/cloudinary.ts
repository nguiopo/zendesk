import { auth } from '../firebase';

export type CloudinaryFolder = 'kb-pdfs' | 'ticket-attachments' | 'avatars';

export interface CloudinaryUpload {
  url: string;
  publicId: string;
  bytes: number;
}

/** Envoie un fichier vers Cloudinary via une signature émise par notre serveur. */
export async function uploadToCloudinary(
  file: Blob,
  folder: CloudinaryFolder,
  fileName = 'file'
): Promise<CloudinaryUpload> {
  const user = auth.currentUser;
  if (!user) throw new Error('Connexion requise pour envoyer un fichier.');
  const idToken = await user.getIdToken();

  const signRes = await fetch('/api/uploads/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ folder }),
  });
  if (!signRes.ok) {
    const err = await signRes.json().catch(() => ({}));
    throw new Error(err.error || 'Signature Cloudinary refusée.');
  }
  const { cloudName, apiKey, timestamp, signature, folder: signedFolder } = await signRes.json();

  const form = new FormData();
  form.append('file', file, fileName);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);
  form.append('folder', signedFolder);

  const upRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await upRes.json().catch(() => ({}));
  if (!upRes.ok) throw new Error(data?.error?.message || 'Échec de l’envoi vers Cloudinary.');
  return { url: String(data.secure_url), publicId: String(data.public_id), bytes: Number(data.bytes) };
}

/** Télécharge un fichier déjà hébergé (ex. pour l'afficher dans le lecteur PDF). */
export async function fetchRemoteBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

/** Copie la photo Google d'un compte vers Cloudinary. Renvoie null en cas d'échec. */
export async function importGoogleAvatar(googlePhotoUrl: string): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    const idToken = await user.getIdToken();
    const res = await fetch('/api/uploads/import-avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ url: googlePhotoUrl }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.url === 'string' ? data.url : null;
  } catch {
    return null;
  }
}
