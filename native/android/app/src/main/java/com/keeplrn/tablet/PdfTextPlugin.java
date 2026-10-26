package com.keeplrn.tablet;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdfparser.PDFParser;
import com.tom_roush.pdfbox.cos.COSDocument;
import com.tom_roush.pdfbox.io.RandomAccessBufferedFileInputStream;
import com.tom_roush.pdfbox.text.PDFTextStripper;
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;

import java.io.File;
import java.io.FileOutputStream;

/** PDF.js 失败时的原生 PDFBox 文本提取兜底。 */
@CapacitorPlugin(name = "PdfText")
public class PdfTextPlugin extends Plugin {
    @PluginMethod
    public void extractText(PluginCall call) {
        String b64 = call.getString("base64", "");
        if (b64 == null || b64.isEmpty()) { call.reject("empty pdf"); return; }
        new Thread(() -> {
            File f = new File(getContext().getCacheDir(), "pdfbox-" + System.currentTimeMillis() + ".pdf");
            PDDocument doc = null;
            try {
                PDFBoxResourceLoader.init(getContext());
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                try (FileOutputStream out = new FileOutputStream(f)) { out.write(bytes); }
                PDFParser parser = new PDFParser(new RandomAccessBufferedFileInputStream(f));
                parser.setLenient(true);
                parser.parse();
                COSDocument cos = parser.getDocument();
                doc = new PDDocument(cos, null);
                PDFTextStripper stripper = new PDFTextStripper();
                String text = stripper.getText(doc);
                JSObject r = new JSObject();
                r.put("text", text == null ? "" : text);
                r.put("pages", doc.getNumberOfPages());
                call.resolve(r);
            } catch (Throwable e) {
                call.reject("PDFBox failed: " + e.getMessage());
            } finally {
                try { if (doc != null) doc.close(); } catch (Throwable ignored) {}
                try { if (f.exists()) f.delete(); } catch (Throwable ignored) {}
            }
        }).start();
    }
}
