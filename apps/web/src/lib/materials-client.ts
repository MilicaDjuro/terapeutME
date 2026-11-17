import { AuthRequestError } from "./auth-client";

export type MaterialKind = "HOMEWORK" | "EXERCISE" | "JOURNAL" | "RESOURCE";
export interface ClientMaterial {
  id: string;
  clientUserId: string;
  kind: MaterialKind;
  title: string;
  instructions: string;
  resourceUrl: string | null;
  dueDate: string | null;
  fileName: string | null;
  fileSize: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  therapistName: string;
  clientName: string;
}
export interface MaterialClient {
  id: string;
  name: string;
  email: string;
}
interface MaterialsResponse {
  materials?: ClientMaterial[];
  clients?: MaterialClient[];
  saved?: boolean;
  id?: string;
}

/** Čita samo JSON grešku servera; PDF bajtovi se ne tumače kao poruka. */
async function checkMaterialResponse(response: Response) {
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  throw new AuthRequestError(
    typeof body?.message === "string"
      ? body.message
      : "Materijal trenutno nije dostupan.",
    response.status,
  );
}

/** Koristi JWT kolačić; browser određuje multipart boundary kada šaljemo PDF. */
export async function requestMaterials(
  path = "",
  body?: FormData | { version: number },
  signal?: AbortSignal,
): Promise<MaterialsResponse> {
  const multipart = body instanceof FormData;
  const response = await fetch(`/api/v1/client-materials${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers:
      body && !multipart ? { "Content-Type": "application/json" } : undefined,
    body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
  });
  await checkMaterialResponse(response);
  return response.json();
}

/** Preuzima privatni PDF uz novu provjeru servera; privremeni browser URL uklanja se poslije klika. */
export async function downloadMaterial(id: string, signal: AbortSignal) {
  const response = await fetch(
    `/api/v1/client-materials/${encodeURIComponent(id)}/file`,
    { credentials: "same-origin", cache: "no-store", signal },
  );
  await checkMaterialResponse(response);
  const blob = await response.blob();
  if (signal.aborted) return;
  const name = response.headers
    .get("Content-Disposition")
    ?.split("filename*=UTF-8''")[1];
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name ? decodeURIComponent(name) : "materijal.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
