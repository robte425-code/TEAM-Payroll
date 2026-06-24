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

function graphCredential(name, fallbackName) {
  return process.env[name]?.trim() || process.env[fallbackName]?.trim() || "";
}

async function getGraphAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expires_at > now + 60_000) {
    return cachedToken.access_token;
  }

  const tenantId =
    graphCredential("SHAREPOINT_AZURE_TENANT_ID", "AZURE_AD_TENANT_ID") ||
    requireEnv("AZURE_AD_TENANT_ID");
  const clientId =
    graphCredential("SHAREPOINT_AZURE_CLIENT_ID", "AZURE_AD_CLIENT_ID") ||
    requireEnv("AZURE_AD_CLIENT_ID");
  const clientSecret =
    graphCredential("SHAREPOINT_AZURE_CLIENT_SECRET", "AZURE_AD_CLIENT_SECRET") ||
    requireEnv("AZURE_AD_CLIENT_SECRET");

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

function backupItemPath(siteId, filename) {
  return `/sites/${siteId}/drive/root:/${encodeURIComponent(SHAREPOINT_BACKUPS_FOLDER)}/${encodeURIComponent(filename)}`;
}

async function parseGraphError(res) {
  const text = await res.text().catch(() => "");
  if (!text) return `HTTP ${res.status}`;
  try {
    const data = JSON.parse(text);
    return data.error?.message || data.error?.code || text;
  } catch {
    return text;
  }
}

async function getUploadedBackupItem(siteId, filename) {
  const res = await graphFetch(
    `${backupItemPath(siteId, filename)}?$select=id,name,size,webUrl,createdDateTime`
  );
  const text = await res.text().catch(() => "");
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok || !data?.id || !data.name) {
    throw new Error(data?.error?.message || text || "Could not read uploaded SharePoint backup");
  }
  return data;
}

async function uploadWithSession(siteId, filename, content) {
  const sessionRes = await graphFetch(`${backupItemPath(siteId, filename)}:/createUploadSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      item: {
        "@microsoft.graph.conflictBehavior": "replace",
        name: filename,
      },
    }),
  });

  const sessionText = await sessionRes.text().catch(() => "");
  let session = null;
  if (sessionText) {
    try {
      session = JSON.parse(sessionText);
    } catch {
      session = null;
    }
  }
  if (!sessionRes.ok || !session?.uploadUrl) {
    throw new Error(session?.error?.message || sessionText || "Could not start SharePoint upload session");
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
      },
      body: chunk,
    });

    if (!response.ok && response.status !== 202 && response.status !== 201) {
      throw new Error(await parseGraphError(response));
    }
  }

  if (!response) throw new Error("SharePoint upload failed");
  if (response.status === 200 || response.status === 201) {
    const completedText = await response.text().catch(() => "");
    if (completedText) {
      try {
        const completed = JSON.parse(completedText);
        if (completed?.id && completed?.name) return completed;
      } catch {
        // fall through to metadata lookup
      }
    }
  }

  return getUploadedBackupItem(siteId, filename);
}

async function uploadSharePointBackup(filename, content, contentType) {
  if (!isSharePointConfigured()) {
    throw new Error("SHAREPOINT_SITE_URL is not configured");
  }

  const siteId = await getSiteId();
  await ensureBackupsFolder(siteId);

  let data;
  if (content.length <= SIMPLE_UPLOAD_MAX_BYTES) {
    const res = await graphFetch(
      `${backupItemPath(siteId, filename)}:/content?@microsoft.graph.conflictBehavior=replace`,
      {
        method: "PUT",
        headers: { "Content-Type": contentType || "application/octet-stream" },
        body: content,
      }
    );
    const text = await res.text().catch(() => "");
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      throw new Error(data?.error?.message || text || `HTTP ${res.status}`);
    }
    if (!data?.id || !data?.name) {
      data = await getUploadedBackupItem(siteId, filename);
    }
  } else {
    data = await uploadWithSession(siteId, filename, content);
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
