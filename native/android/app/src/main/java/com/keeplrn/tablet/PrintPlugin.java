package com.keeplrn.tablet;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Android WebView 不支持 window.print()；把导出的 HTML 载入一个隐藏 WebView，
 *  再交给系统打印框架（用户在面板里选「另存为 PDF」即可真正存成 PDF）。
 *  仅原生 App 使用；浏览器/桌面仍走 iframe 打印。*/
@CapacitorPlugin(name = "Print")
public class PrintPlugin extends Plugin {
    private WebView printView;

    @PluginMethod
    public void printHtml(PluginCall call) {
        final String html = call.getString("html", "");
        final String name = call.getString("name", "KeepLearning");
        if (html == null || html.isEmpty()) {
            call.reject("empty html");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                final WebView wv = new WebView(getContext());
                wv.getSettings().setJavaScriptEnabled(false);
                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        try {
                            PrintManager pm = (PrintManager) getContext()
                                    .getSystemService(Context.PRINT_SERVICE);
                            String job = "Keep Learning - " + name;
                            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(job);
                            pm.print(job, adapter, new PrintAttributes.Builder().build());
                            JSObject r = new JSObject();
                            r.put("ok", true);
                            call.resolve(r);
                        } catch (Throwable e) {
                            call.reject("print failed: " + e.getMessage());
                        }
                    }
                });
                /* 常驻引用，避免打印过程中被 GC */
                printView = wv;
                wv.loadDataWithBaseURL("https://localhost/", html, "text/html", "utf-8", null);
            } catch (Throwable e) {
                call.reject("print init failed: " + e.getMessage());
            }
        });
    }
}
