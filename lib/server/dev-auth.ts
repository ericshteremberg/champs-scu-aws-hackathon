/** Authentication for the separate, shared development deployment only. */
export type DevelopmentAuthEnvironment = {
  DEPLOYMENT_MODE?: string;
  DEV_ACCESS_PASSWORD?: string;
};

const identity = {
  id: "causality-development-reviewer",
  email: "development-reviewer@example.invalid",
  name: "Development reviewer",
};

function privateResponse(
  message: string,
  status: number,
  challenge = false,
): Response {
  const headers = new Headers({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (challenge)
    headers.set(
      "WWW-Authenticate",
      'Basic realm="Causality development", charset="UTF-8"',
    );
  return new Response(message, { status, headers });
}

function credentials(
  header: string | null,
): { username: string; password: string } | null {
  if (!header || header.length > 8192) return null;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header.trim());
  if (!match) return null;
  try {
    const bytes = Uint8Array.from(atob(match[1]), (character) =>
      character.charCodeAt(0),
    );
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const separator = value.indexOf(":");
    if (separator < 0) return null;
    return {
      username: value.slice(0, separator),
      password: value.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

async function matchesSecret(
  candidate: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(expectedHash);
  // Compare every byte of equal-length digests, without a mismatch short circuit.
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export async function authenticateDevelopmentRequest(
  request: Request,
  env: DevelopmentAuthEnvironment,
): Promise<Request | Response> {
  if (!env.DEPLOYMENT_MODE) return request;
  if (env.DEPLOYMENT_MODE !== "standalone-dev") {
    return privateResponse("This deployment mode is not configured.", 503);
  }
  if (
    typeof env.DEV_ACCESS_PASSWORD !== "string" ||
    env.DEV_ACCESS_PASSWORD.length < 32
  ) {
    return privateResponse(
      "Development access has not been configured by the operator.",
      503,
    );
  }
  const url = new URL(request.url);
  if (url.protocol !== "https:")
    return privateResponse(
      "Use HTTPS to access this development workspace.",
      403,
    );

  const provided = credentials(request.headers.get("Authorization"));
  const passwordMatches = await matchesSecret(
    provided?.password ?? "",
    env.DEV_ACCESS_PASSWORD,
  );
  if (!provided || provided.username !== "dev" || !passwordMatches) {
    return privateResponse(
      "Authenticate with the development workspace credentials.",
      401,
      true,
    );
  }

  if (url.pathname === "/signout-with-chatgpt") {
    return privateResponse(
      "Development authentication is required. Your browser may keep Basic authentication credentials until you close its private window or clear the saved credentials.",
      401,
      true,
    );
  }
  if (url.pathname === "/signin-with-chatgpt" || url.pathname === "/callback") {
    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL("/workspace", url).toString(),
        "Cache-Control": "private, no-store",
      },
    });
  }

  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("oai-authenticated-"))
      headers.delete(name);
  }
  headers.delete("Authorization");
  headers.set("oai-authenticated-user-id", identity.id);
  headers.set("oai-authenticated-user-email", identity.email);
  headers.set("oai-authenticated-user-full-name", identity.name);
  headers.set(
    "oai-authenticated-user-full-name-encoding",
    "percent-encoded-utf-8",
  );
  return new Request(request, { headers });
}
