package com.rems.thesis;

import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class MainActivity extends AppCompatActivity {

    // Default Public Tunnel URL (can be edited directly inside the app)
    public static final String DEFAULT_URL = "https://anyone-cancelled-usage-politics.trycloudflare.com";
    private static final String PREFS_NAME = "rems_prefs";
    private static final String KEY_SERVER_URL = "server_url";

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private LinearLayout layoutError;
    private Button btnRetry;
    private Button btnChangeUrl;
    private SharedPreferences prefs;

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

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        // Customize User Agent to ensure Flask serves the Mobile UI
        String customUA = settings.getUserAgentString() + " REMSMobileApp/1.0 (Android)";
        settings.setUserAgentString(customUA);

        webView.setWebViewClient(new WebViewClient() {
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

    private void setupEvents() {
        swipeRefresh.setOnRefreshListener(this::loadDashboard);

        btnRetry.setOnClickListener(v -> {
            layoutError.setVisibility(View.GONE);
            loadDashboard();
        });

        btnChangeUrl.setOnClickListener(v -> showChangeUrlDialog());
    }

    private void loadDashboard() {
        String currentUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_URL);
        if (!currentUrl.endsWith("/mobile") && !currentUrl.contains("?")) {
            currentUrl = currentUrl.replaceAll("/+$", "") + "/mobile";
        }
        webView.loadUrl(currentUrl);
    }

    private void showChangeUrlDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Server URL Configuration");
        builder.setMessage("Enter the Tunnel HTTPS URL or Local IP of your Raspberry Pi (e.g., http://192.168.1.9:5000):");

        final EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setText(prefs.getString(KEY_SERVER_URL, DEFAULT_URL));
        input.setSelection(input.getText().length());
        builder.setView(input);

        builder.setPositiveButton("Save & Connect", (dialog, which) -> {
            String newUrl = input.getText().toString().trim();
            if (!newUrl.isEmpty()) {
                if (!newUrl.startsWith("http://") && !newUrl.startsWith("https://")) {
                    newUrl = "https://" + newUrl;
                }
                prefs.edit().putString(KEY_SERVER_URL, newUrl).apply();
                Toast.makeText(MainActivity.this, "URL updated!", Toast.LENGTH_SHORT).show();
                layoutError.setVisibility(View.GONE);
                loadDashboard();
            }
        });

        builder.setNeutralButton("Reset Default", (dialog, which) -> {
            prefs.edit().putString(KEY_SERVER_URL, DEFAULT_URL).apply();
            layoutError.setVisibility(View.GONE);
            loadDashboard();
        });

        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());
        builder.show();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
