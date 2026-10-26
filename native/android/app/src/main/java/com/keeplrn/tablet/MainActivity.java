package com.keeplrn.tablet;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TtsPlugin.class);
        registerPlugin(AudioPackPlugin.class);
        registerPlugin(LocalTtsPlugin.class);
        registerPlugin(PdfTextPlugin.class);
        registerPlugin(PrintPlugin.class);
        super.onCreate(savedInstanceState);
        try {
            WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
            if (webView != null) webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        } catch (Throwable ignored) { }
    }
}