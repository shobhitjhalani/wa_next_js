"use client";

import { useEffect } from "react";

// WhatsApp Embedded Signup from dashboard.php. On FINISH the phone number / WABA ids
// are posted to /user_update, which saves them and registers the number with Meta.
const APP_ID = "859501530523310";
const CONFIG_ID = "1912209822802104";

type FB = {
  init: (o: Record<string, unknown>) => void;
  login: (cb: (r: unknown) => void, o: Record<string, unknown>) => void;
};

export default function FacebookSignup() {
  useEffect(() => {
    const w = window as unknown as { FB?: FB; fbAsyncInit?: () => void };
    w.fbAsyncInit = () => w.FB?.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: true, version: "v25.0" });
    if (!document.getElementById("facebook-jssdk")) {
      const s = document.createElement("script");
      s.id = "facebook-jssdk";
      s.async = true;
      s.defer = true;
      s.crossOrigin = "anonymous";
      s.src = "https://connect.facebook.net/en_US/sdk.js";
      document.body.appendChild(s);
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== "https://www.facebook.com") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "WA_EMBEDDED_SIGNUP" && data.event === "FINISH") {
          const { phone_number_id, waba_id, business_id } = data.data;
          fetch("/user_update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone_number_id, waba_id, business_id, status: "success" }),
          }).then(() => window.location.reload());
        }
      } catch {
        // not JSON
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const launch = () => {
    const w = window as unknown as { FB?: FB };
    w.FB?.login(() => undefined, {
      config_id: CONFIG_ID,
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
    });
  };

  return (
    <>
      <div id="fb-root"></div>
      <button
        type="button"
        onClick={launch}
        style={{
          backgroundColor: "#1877f2",
          border: 0,
          borderRadius: 4,
          color: "#fff",
          cursor: "pointer",
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: 16,
          fontWeight: "bold",
          height: 40,
          padding: "0 24px",
        }}
      >
        Login with Facebook
      </button>
    </>
  );
}
