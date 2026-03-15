// Exchange the code Google gave us for an access token,
// then use that token to fetch the user's profile

export async function getGoogleAuthUrl(clientId: string, redirectUri: string, state: string): Promise<string> {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        access_type: "offline",
        state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForProfile(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
) {
    // Step 1: exchange code → tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
        }),
    });

    if (!tokenRes.ok) throw new Error("Failed to exchange code for token");
    const { access_token } = await tokenRes.json() as { access_token: string };

    // Step 2: use access token → get user profile
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!profileRes.ok) throw new Error("Failed to fetch Google profile");

    return profileRes.json() as Promise<{
        sub: string;      // Google's unique user ID
        email: string;
        name: string;
        picture: string;
    }>;
}