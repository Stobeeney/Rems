package com.rems.thesis;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.Locale;
import java.util.regex.Pattern;

public class MainActivity extends AppCompatActivity {

    private static final String PREFS_NAME = "rems_prefs";
    private static final String KEY_SERVER_URL = "server_url";
    // Pairing mode: the Pi runs a free Cloudflare quick tunnel whose URL changes on restart.
    // The Pi posts the current URL to ntfy.sh under a topic derived from its pairing code.
    private static final String KEY_PAIR_CODE = "pair_code";
    private static final String KEY_TUNNEL_URL = "tunnel_url";      // last URL found for the pairing code
    private static final String NTFY_SERVER = "https://ntfy.sh";
    private static final String PAIR_COOKIE = "rems_pair";
    private static final Pattern TUNNEL_URL_PATTERN = Pattern.compile("^https://[a-z0-9-]+\\.trycloudflare\\.com$");
    private static final String BRIDGE_NAME = "AndroidREMS";
    private static final String URL_HINT = "Pairing code (e.g. ABCD-EFGH-JKMN) or http://192.168.1.9:5000";

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private LinearLayout layoutError;
    private Button btnRetry;
    private Button btnChangeUrl;
    private SharedPreferences prefs;
    private boolean bridgeRegistered = false;
    private TextView tvErrorTitle;
    private TextView tvErrorMessage;
    private boolean triedFreshTunnelUrl = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        webView = findViewById(R.id.webView);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        layoutError = findViewById(R.id.layoutError);
        btnRetry = findViewById(R.id.btnRetry);
        btnChangeUrl = findViewById(R.id.btnChangeUrl);
        tvErrorTitle = findViewById(R.id.tvErrorTitle);
        tvErrorMessage = findViewById(R.id.tvErrorMessage);

        setupWebView();
        setupEvents();

        loadDashboard();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // Customize User Agent to ensure Flask serves the Mobile UI
        String customUA = settings.getUserAgentString() + " REMSMobileApp/1.0 (Android)";
        settings.setUserAgentString(customUA);

        // Long press gesture fallback to change URL anytime
        webView.setOnLongClickListener(v -> {
            showChangeUrlDialog();
            return true;
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Only the configured REMS server may load inside the app; anything else opens externally
                Uri target = request.getUrl();
                if (isServerOrigin(target) || isCloudflareAccessLogin(target)) {
                    return false;
                }
                openExternally(target);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                layoutError.setVisibility(View.GONE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                swipeRefresh.setRefreshing(false);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    onMainFrameFailed();
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                super.onReceivedHttpError(view, request, response);
                // A stale quick-tunnel URL answers with Cloudflare errors (404/502/530)
                if (request.isForMainFrame() && isPaired() && response.getStatusCode() >= 404
                        && response.getStatusCode() != 401) {
                    onMainFrameFailed();
                }
            }
        });
    }

    /**
     * Exposes window.AndroidREMS to the configured server origin only.
     * Pages from any other origin (including embedded iframes) never see the bridge.
     */
    private void registerBridge(String origin) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            return;
        }
        if (bridgeRegistered) {
            WebViewCompat.removeWebMessageListener(webView, BRIDGE_NAME);
            bridgeRegistered = false;
        }
        if (origin == null) {
            return;
        }
        WebViewCompat.addWebMessageListener(webView, BRIDGE_NAME, Collections.singleton(origin),
                (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                    if (isMainFrame && "openServerConfig".equals(message.getData())) {
                        showChangeUrlDialog();
                    }
                });
        bridgeRegistered = true;
    }

    private void setupEvents() {
        swipeRefresh.setOnRefreshListener(this::loadDashboard);

        btnRetry.setOnClickListener(v -> {
            layoutError.setVisibility(View.GONE);
            loadDashboard();
        });

        btnChangeUrl.setOnClickListener(v -> showChangeUrlDialog());

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    private void onMainFrameFailed() {
        // In pairing mode the tunnel URL may have changed since we last looked it up: look it up once more
        if (isPaired() && !triedFreshTunnelUrl) {
            triedFreshTunnelUrl = true;
            prefs.edit().remove(KEY_TUNNEL_URL).apply();
            loadPaired(true);
            return;
        }
        showOffline();
    }

    private void showOffline() {
        swipeRefresh.setRefreshing(false);
        tvErrorTitle.setText("⚡ REMCS System Offline");
        tvErrorMessage.setText("Unable to reach the Raspberry Pi. Check that the Pi is on and connected "
                + "to the internet, then tap Retry.");
        btnRetry.setVisibility(View.VISIBLE);
        btnChangeUrl.setText("Change Pairing Code / URL");
        layoutError.setVisibility(View.VISIBLE);
    }

    /** First launch: nothing configured yet, ask for the pairing code. */
    private void showSetup() {
        swipeRefresh.setRefreshing(false);
        webView.loadUrl("about:blank");
        tvErrorTitle.setText("⚡ Welcome to REMCS");
        tvErrorMessage.setText("Connect this phone to your Raspberry Pi using the pairing code shown on the "
                + "Pi screen (Settings → Remote Access).");
        btnRetry.setVisibility(View.GONE);
        btnChangeUrl.setText("Enter Pairing Code");
        layoutError.setVisibility(View.VISIBLE);
        showChangeUrlDialog();
    }

    private boolean isPaired() {
        return !prefs.getString(KEY_PAIR_CODE, "").isEmpty();
    }

    private String getServerUrl() {
        if (isPaired()) {
            return prefs.getString(KEY_TUNNEL_URL, "");
        }
        return prefs.getString(KEY_SERVER_URL, BuildConfig.DEFAULT_SERVER_URL);
    }

    private void loadDashboard() {
        triedFreshTunnelUrl = false;
        if (isPaired()) {
            loadPaired(true);
            return;
        }
        openServer(getServerUrl());
    }

    /** Finds the Pi's current tunnel URL (from ntfy.sh) in the background, then opens it. */
    private void loadPaired(boolean lookUp) {
        String code = prefs.getString(KEY_PAIR_CODE, "");
        swipeRefresh.setRefreshing(true);
        new Thread(() -> {
            String url = lookUp ? lookUpTunnelUrl(code) : null;
            runOnUiThread(() -> {
                if (url != null) {
                    prefs.edit().putString(KEY_TUNNEL_URL, url).apply();
                }
                String target = prefs.getString(KEY_TUNNEL_URL, "");
                if (target.isEmpty()) {
                    showOffline();
                    Toast.makeText(this, "Can't find the Pi. Is it on and connected to the internet?",
                            Toast.LENGTH_LONG).show();
                    return;
                }
                CookieManager cookies = CookieManager.getInstance();
                cookies.setAcceptCookie(true);
                cookies.setCookie(target, PAIR_COOKIE + "=" + code
                        + "; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax");
                cookies.flush();
                openServer(target);
            });
        }).start();
    }

    /** Latest tunnel URL the Pi published for this pairing code, or null. */
    private static String lookUpTunnelUrl(String code) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(NTFY_SERVER + "/" + topicFor(code) + "/json?poll=1&since=12h");
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            String latest = null;
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    JSONObject msg = new JSONObject(line);
                    String text = msg.optString("message", "").trim();
                    if ("message".equals(msg.optString("event")) && TUNNEL_URL_PATTERN.matcher(text).matches()) {
                        latest = text;   // messages arrive oldest first
                    }
                }
            }
            return latest;
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    /** Must match pair_topic() in backend/app.py. */
    private static String topicFor(String code) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            byte[] hash = sha.digest(("remcs-topic:" + code).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) {
                hex.append(String.format(Locale.ROOT, "%02x", b));
            }
            return "remcs-" + hex.substring(0, 24);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** A pairing code has only letters/digits (dashes optional), never a dot or colon like a URL. */
    private static String asPairCode(String raw) {
        String trimmed = raw.trim();
        if (trimmed.contains(".") || trimmed.contains(":") || trimmed.contains("/")) {
            return null;
        }
        String code = trimmed.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
        return (code.length() >= 10 && code.length() <= 16) ? code : null;
    }

    private static String displayPairCode(String code) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < code.length(); i += 4) {
            if (out.length() > 0) {
                out.append('-');
            }
            out.append(code, i, Math.min(i + 4, code.length()));
        }
        return out.toString();
    }

    private void openServer(String serverUrl) {
        if (serverUrl.isEmpty()) {
            showSetup();
            return;
        }
        layoutError.setVisibility(View.GONE);

        registerBridge(originOf(Uri.parse(serverUrl)));

        String currentUrl = serverUrl;
        if (!currentUrl.endsWith("/mobile") && !currentUrl.contains("?")) {
            currentUrl = currentUrl.replaceAll("/+$", "") + "/mobile";
        }
        webView.loadUrl(currentUrl);
    }

    private void showChangeUrlDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Connect to your Pi");
        builder.setMessage("Anywhere (mobile data): enter the PAIRING CODE shown on the Pi screen "
                + "(Settings → Remote Access).\n\n"
                + "Same Wi-Fi only: you can also enter the Pi's local IP, e.g. http://192.168.1.9:5000.");

        final EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint(URL_HINT);
        input.setText(isPaired() ? displayPairCode(prefs.getString(KEY_PAIR_CODE, ""))
                : prefs.getString(KEY_SERVER_URL, BuildConfig.DEFAULT_SERVER_URL));
        input.setSelection(input.getText().length());
        builder.setView(input);

        builder.setPositiveButton("Save & Connect", (dialog, which) -> {
            String pairCode = asPairCode(input.getText().toString());
            if (pairCode != null) {
                prefs.edit().putString(KEY_PAIR_CODE, pairCode).remove(KEY_TUNNEL_URL)
                        .putString(KEY_SERVER_URL, "").apply();
                Toast.makeText(MainActivity.this, "Pairing code saved. Finding your Pi…", Toast.LENGTH_SHORT).show();
                layoutError.setVisibility(View.GONE);
                loadDashboard();
                return;
            }
            String newUrl = normalizeUrl(input.getText().toString());
            String problem = validateServerUrl(newUrl);
            if (problem != null) {
                Toast.makeText(MainActivity.this, problem, Toast.LENGTH_LONG).show();
                showChangeUrlDialog();
                return;
            }
            prefs.edit().putString(KEY_SERVER_URL, newUrl).remove(KEY_PAIR_CODE).remove(KEY_TUNNEL_URL).apply();
            Toast.makeText(MainActivity.this, "URL updated!", Toast.LENGTH_SHORT).show();
            layoutError.setVisibility(View.GONE);
            loadDashboard();
        });


        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());
        builder.show();
    }

    private static String normalizeUrl(String raw) {
        String url = raw.trim();
        if (url.isEmpty()) {
            return url;
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            // Bare LAN IPs default to http, everything else to https
            url = (isPrivateHost(url.split("[:/]")[0]) ? "http://" : "https://") + url;
        }
        return url.replaceAll("/+$", "");
    }

    /** Returns an error message, or null if the URL is acceptable. */
    private static String validateServerUrl(String url) {
        if (url.isEmpty()) {
            return "Please enter a server URL.";
        }
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (host == null || host.isEmpty() || (!"http".equals(scheme) && !"https".equals(scheme))) {
            return "Invalid URL. Example: " + URL_HINT;
        }
        if ("http".equals(scheme) && !isPrivateHost(host)) {
            return "Unencrypted http:// is only allowed for local network IPs. Use https:// for tunnel URLs.";
        }
        return null;
    }

    /** True for loopback, RFC 1918 private IPv4 addresses and mDNS .local hostnames. */
    private static boolean isPrivateHost(String host) {
        if (host == null) {
            return false;
        }
        host = host.toLowerCase(Locale.ROOT);
        if (host.equals("localhost") || host.endsWith(".local")) {
            return true;
        }
        String[] parts = host.split("\\.");
        if (parts.length != 4) {
            return false;
        }
        int[] octets = new int[4];
        try {
            for (int i = 0; i < 4; i++) {
                octets[i] = Integer.parseInt(parts[i]);
                if (octets[i] < 0 || octets[i] > 255) {
                    return false;
                }
            }
        } catch (NumberFormatException e) {
            return false;
        }
        return octets[0] == 10
                || octets[0] == 127
                || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                || (octets[0] == 192 && octets[1] == 168);
    }

    /** scheme://host[:port], matching the format WebView origin rules expect. */
    private static String originOf(Uri uri) {
        if (uri == null || uri.getScheme() == null || uri.getHost() == null) {
            return null;
        }
        String origin = uri.getScheme().toLowerCase(Locale.ROOT) + "://" + uri.getHost().toLowerCase(Locale.ROOT);
        if (uri.getPort() != -1) {
            origin += ":" + uri.getPort();
        }
        return origin;
    }

    private boolean isServerOrigin(Uri target) {
        String serverUrl = getServerUrl();
        String serverOrigin = serverUrl.isEmpty() ? null : originOf(Uri.parse(serverUrl));
        return serverOrigin != null && serverOrigin.equals(originOf(target));
    }

    /** Cloudflare Access login pages must stay in the WebView so the auth cookie lands there. */
    private static boolean isCloudflareAccessLogin(Uri target) {
        String host = target.getHost();
        return "https".equals(target.getScheme()) && host != null
                && host.toLowerCase(Locale.ROOT).endsWith(".cloudflareaccess.com");
    }

    private void openExternally(Uri target) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, target));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app available to open this link.", Toast.LENGTH_SHORT).show();
        }
    }
}
