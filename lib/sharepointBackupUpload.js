const SHAREPOINT_BACKUPS_FOLDER = "Backups";
const SIMPLE_UPLOAD_MAX_BYTES = 3.5 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024;

let cachedToken = null;
let cachedSiteId = null;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function isSharePointConfigured() {
  return Boolean(process.env.SHAREPOINT_SITE_URL?.trim());
}

function sharePointSiteRef() {
  const siteUrl = requireEnv("SHAREPOINT_SITE_URL");
  const parsed = new URL(siteUrl);
  return { hostname: parsed.hostname, path: parsed.pathname.replace(/\/$/, "") || "/" };
}

async function getGraphAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expires_at > now + 60_000) {
    return cachedToken.access_token;
  }

  const tenantId = requireEnv("AZURE_AD_TENANT_ID");
  const clientId = requireEnv("AZURE_AD_CLIENT_ID");
  const clientSecret = requireEnv("AZURE_AD_CLIENT_SECRET");

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || "Could not authenticate with Microsoft Graph");
  }

  cachedToken = {
    access_token: data.access_token,
    expires_at: now + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.access_token;
}

async function graphFetch(path, init) {
  const token = await getGraphAccessToken();
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

async function getSiteId() {
  if (cachedSiteId) return cachedSiteId;
  const { hostname, path } = sharePointSiteRef();
  const res = await graphFetch(`/sites/${hostname}:${path}`);
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message || "Could not resolve SharePoint site");
  }
  cachedSiteId = data.id;
  return cachedSiteId;
}

async function ensureBackupsFolder(siteId) {
  const res = await graphFetch(
    `/sites/${siteId}/drive/root:/${encodeURIComponent(SHAREPOINT_BACKUPS_FOLDER)}`
  );
  if (res.ok) return;
  if (res.status !== 404) {
    const data = await res.json();
    throw new Error(data.error?.message || "Could not access SharePoint Backups folder");
  }

  const create = await graphFetch(`/sites/${siteId}/drive/root/children`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: SHAREPOINT_BACKUPS_FOLDER,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });

  if (!create.ok && create.status !== 409) {
    const data = await create.json();
    throw new Error(data.error?.message || "Could not create SharePoint Backups folder");
  }
}

async function uploadWithSession(siteId, filename, content, contentType) {
  const itemPath = `/sites/${siteId}/drive/root:/${encodeURIComponent(SHAREPOINT_BACKUPS_FOLDER)}/${encodeURIComponent(filename)}`;
  const sessionRes = await graphFetch(`${itemPath}:/createUploadSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      item: { "@microsoft.graph.conflictBehavior": "replace" },
    }),
  });

  const session = await sessionRes.json();
  if (!sessionRes.ok || !session.uploadUrl) {
    throw new Error(session.error?.message || "Could not start SharePoint upload session");
  }

  let response = null;
  for (let start = 0; start < content.length; start += UPLOAD_CHUNK_BYTES) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, content.length) - 1;
    const chunk = content.subarray(start, end + 1);
    response = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end}/${content.length}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      body: chunk,
    });

    if (!response.ok && response.status !== 202 && response.status !== 201) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `SharePoint upload failed (${response.status})`);
    }
  }

  if (!response) throw new Error("SharePoint upload failed");
  if (response.status === 200 || response.status === 201) {
    return response.json();
  }
  throw new Error("SharePoint upload did not complete");
}

async function uploadSharePointBackup(filename, content, contentType) {
  if (!isSharePointConfigured()) {
    throw new Error("SHAREPOINT_SITE_URL is not configured");
  }

  const siteId = await getSiteId();
  await ensureBackupsFolder(siteId);

  let data;
  if (content.length <= SIMPLE_UPLOAD_MAX_BYTES) {
    const path = `/sites/${siteId}/drive/root:/${encodeURIComponent(SHAREPOINT_BACKUPS_FOLDER)}/${encodeURIComponent(filename)}:/content`;
    const res = await graphFetch(path, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: content,
    });
    data = await res.json();
    if (!res.ok || !data.id) {
      throw new Error(data.error?.message || "Could not upload backup to SharePoint");
    }
  } else {
    data = await uploadWithSession(siteId, filename, content, contentType);
  }

  return {
    id: data.id,
    name: data.name,
    size: data.size ?? content.length,
    webUrl: data.webUrl ?? "",
    createdAt: data.createdDateTime ?? new Date().toISOString(),
  };
}

async function downloadSharePointBackup(itemId) {
  if (!isSharePointConfigured()) {
    throw new Error("SHAREPOINT_SITE_URL is not configured");
  }

  const siteId = await getSiteId();
  const res = await graphFetch(`/sites/${siteId}/drive/items/${itemId}/content`);
  if (!res.ok) {
    throw new Error("Could not download backup from SharePoint");
  }

  const contentDisposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/i.exec(contentDisposition);
  const name = match?.[1] ?? "backup.bin";
  const content = Buffer.from(await res.arrayBuffer());
  return { name, content };
}

module.exports = {
  downloadSharePointBackup,
  isSharePointConfigured,
  uploadSharePointBackup,
};
