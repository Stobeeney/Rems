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
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.Collections;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    private static final String PREFS_NAME = "rems_prefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String BRIDGE_NAME = "AndroidREMS";
    // Demo Mode: bundled mobile UI with simulated data, used when no server URL is configured
    private static final String DEMO_ORIGIN = "https://" + WebViewAssetLoader.DEFAULT_DOMAIN;
    private static final String DEMO_URL = DEMO_ORIGIN + "/assets/demo/mobile.html";
    private static final String URL_HINT = "http://192.168.1.9:5000 or https://your-tunnel.example.com";

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private LinearLayout layoutError;
    private Button btnRetry;
    private Button btnChangeUrl;
    private SharedPreferences prefs;
    private boolean bridgeRegistered = false;
    private WebViewAssetLoader assetLoader;

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

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

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
                    swipeRefresh.setRefreshing(false);
                    layoutError.setVisibility(View.VISIBLE);
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

    private String getServerUrl() {
        return prefs.getString(KEY_SERVER_URL, BuildConfig.DEFAULT_SERVER_URL);
    }

    private void loadDashboard() {
        String serverUrl = getServerUrl();
        if (serverUrl.isEmpty()) {
            // No server configured yet: run the bundled UI on simulated data
            registerBridge(DEMO_ORIGIN);
            webView.loadUrl(DEMO_URL);
            return;
        }

        registerBridge(originOf(Uri.parse(serverUrl)));

        String currentUrl = serverUrl;
        if (!currentUrl.endsWith("/mobile") && !currentUrl.contains("?")) {
            currentUrl = currentUrl.replaceAll("/+$", "") + "/mobile";
        }
        webView.loadUrl(currentUrl);
    }

    private void showChangeUrlDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Server URL Configuration");
        builder.setMessage("Enter the Tunnel HTTPS URL or Local IP of your Raspberry Pi.\n\n"
                + "Plain http:// is only allowed for local network addresses (e.g. http://192.168.1.9:5000).");

        final EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint(URL_HINT);
        input.setText(getServerUrl());
        input.setSelection(input.getText().length());
        builder.setView(input);

        builder.setPositiveButton("Save & Connect", (dialog, which) -> {
            String newUrl = normalizeUrl(input.getText().toString());
            String problem = validateServerUrl(newUrl);
            if (problem != null) {
                Toast.makeText(MainActivity.this, problem, Toast.LENGTH_LONG).show();
                showChangeUrlDialog();
                return;
            }
            prefs.edit().putString(KEY_SERVER_URL, newUrl).apply();
            Toast.makeText(MainActivity.this, "URL updated!", Toast.LENGTH_SHORT).show();
            layoutError.setVisibility(View.GONE);
            loadDashboard();
        });

        builder.setNeutralButton("Demo Mode", (dialog, which) -> {
            prefs.edit().putString(KEY_SERVER_URL, "").apply();
            Toast.makeText(MainActivity.this, "Demo Mode: simulated data", Toast.LENGTH_SHORT).show();
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
        String serverOrigin = serverUrl.isEmpty() ? DEMO_ORIGIN : originOf(Uri.parse(serverUrl));
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
