package com.keeplrn.tablet;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 本地离线 TTS：Piper VITS 四个标准音色；只合成，播放交给 AudioPackPlugin。 */
@CapacitorPlugin(name = "LocalTts")
public class LocalTtsPlugin extends Plugin {
    private final Map<String, OfflineTts> models = new HashMap<>();
    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    private volatile boolean loading = false;

    private static final String ROOT = "public/assets/models/piper";
    private static final String ESPEAK_ASSET = ROOT + "/espeak-ng-data";
    private static final Map<String, String> MODEL_FILES = new HashMap<>();
    static {
        /* 2026-10-22 按用户反馈移除英音男声 alan（不像四六级），男声默认用 ryan */
        MODEL_FILES.put("jenny", "jenny/model.onnx");
        MODEL_FILES.put("ryan", "ryan/model.onnx");
        MODEL_FILES.put("amy", "amy/model.onnx");
        /* 2026-10-22 用户要求再加一个男声：joe（en-US 男声，作为 ryan 之外的第二选择） */
        MODEL_FILES.put("joe", "joe/model.onnx");
    }

    private static String tokensFor(String voice) {
        return ROOT + "/" + voice + "/tokens.txt";
    }

    private void copyAssetDir(String assetPath, File dst) throws IOException {
        String[] children = getContext().getAssets().list(assetPath);
        if (children == null || children.length == 0) {
            dst.getParentFile().mkdirs();
            try (InputStream in = getContext().getAssets().open(assetPath);
                 FileOutputStream out = new FileOutputStream(dst)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return;
        }
        dst.mkdirs();
        for (String child : children) copyAssetDir(assetPath + "/" + child, new File(dst, child));
    }

    /** eSpeak 需要真实文件系统路径；APK assets 里的 dataDir 原生层不能直接 fopen。 */
    private File ensureEspeakDir() throws IOException {
        File dir = new File(getContext().getFilesDir(), "piper-espeak-ng-data");
        if (new File(dir, "phontab").exists()) return dir;
        copyAssetDir(ESPEAK_ASSET, dir);
        return dir;
    }

    private synchronized OfflineTts ensureTts(String voice) {
        if (models.containsKey(voice)) return models.get(voice);
        String modelFile = MODEL_FILES.get(voice);
        if (modelFile == null) throw new IllegalArgumentException("unknown voice: " + voice);
        loading = true;
        try {
            File espeakDir;
            try { espeakDir = ensureEspeakDir(); }
            catch (IOException e) { throw new RuntimeException("copy espeak-ng-data failed: " + e.getMessage(), e); }
            OfflineTtsVitsModelConfig vits = new OfflineTtsVitsModelConfig(
                ROOT + "/" + modelFile,
                "",
                tokensFor(voice),
                espeakDir.getAbsolutePath(),
                "",
                0.667f,
                0.8f,
                1.0f);
            OfflineTtsModelConfig model = new OfflineTtsModelConfig();
            model.setVits(vits);
            model.setNumThreads(2);
            model.setDebug(false);
            model.setProvider("cpu");
            OfflineTtsConfig config = new OfflineTtsConfig(model, "", "", 1, 0.2f);
            OfflineTts tts = new OfflineTts(getContext().getAssets(), config);
            models.put(voice, tts);
            return tts;
        } finally {
            loading = false;
        }
    }

    private static String sha1(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            StringBuilder sb = new StringBuilder();
            for (byte x : md.digest(s.getBytes("UTF-8"))) sb.append(String.format("%02x", x));
            return sb.toString();
        } catch (Exception e) { return String.valueOf(s.hashCode()); }
    }

    /* ---------- WAV 写出：补首尾静音（16-bit PCM，单声道） ---------- */
    private static void writeAscii(FileOutputStream fos, String s) throws IOException { fos.write(s.getBytes("US-ASCII")); }
    private static void writeIntLE(FileOutputStream fos, int v) throws IOException {
        fos.write(v & 0xff); fos.write((v >> 8) & 0xff); fos.write((v >> 16) & 0xff); fos.write((v >> 24) & 0xff);
    }
    private static void writeShortLE(FileOutputStream fos, int v) throws IOException {
        fos.write(v & 0xff); fos.write((v >> 8) & 0xff);
    }
    private static int putSample(byte[] buf, int bi, FileOutputStream fos, float s) throws IOException {
        int v = Math.round(Math.max(-1f, Math.min(1f, s)) * 32767f);
        buf[bi++] = (byte) (v & 0xff);
        buf[bi++] = (byte) ((v >> 8) & 0xff);
        if (bi >= buf.length) { fos.write(buf, 0, bi); bi = 0; }
        return bi;
    }
    private static void saveWavWithPadding(File out, float[] samples, int sampleRate, float leadSec, float tailSec) throws IOException {
        int rate = sampleRate > 0 ? sampleRate : 22050;
        int lead = Math.max(0, Math.round(rate * leadSec));
        int tail = Math.max(0, Math.round(rate * tailSec));
        int count = (samples == null ? 0 : samples.length);
        int frames = lead + count + tail;
        int dataBytes = frames * 2;
        try (FileOutputStream fos = new FileOutputStream(out)) {
            writeAscii(fos, "RIFF"); writeIntLE(fos, 36 + dataBytes); writeAscii(fos, "WAVE");
            writeAscii(fos, "fmt "); writeIntLE(fos, 16); writeShortLE(fos, 1); writeShortLE(fos, 1);
            writeIntLE(fos, rate); writeIntLE(fos, rate * 2); writeShortLE(fos, 2); writeShortLE(fos, 16);
            writeAscii(fos, "data"); writeIntLE(fos, dataBytes);
            byte[] buf = new byte[8192];
            int bi = 0;
            for (int i = 0; i < lead; i++) bi = putSample(buf, bi, fos, 0f);
            if (samples != null) for (float s : samples) bi = putSample(buf, bi, fos, s);
            for (int i = 0; i < tail; i++) bi = putSample(buf, bi, fos, 0f);
            if (bi > 0) fos.write(buf, 0, bi);
        }
    }

    @PluginMethod
    public void init(PluginCall call) {
        pool.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("voices", new String[]{"jenny", "ryan", "amy", "joe"});
                call.resolve(r);
            } catch (Throwable e) {
                call.reject("local tts init failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void synthesize(PluginCall call) {
        String text = call.getString("text", "");
        String voice = call.getString("voice", "alan");
        if (voice == null || !MODEL_FILES.containsKey(voice)) voice = "ryan";
        if (text == null || text.trim().isEmpty()) { call.reject("text is empty"); return; }
        final String v = voice;
        pool.execute(() -> {
            try {
                OfflineTts t = ensureTts(v);
                File dir = new File(getContext().getFilesDir(), "tts-cache");
                if (!dir.exists()) dir.mkdirs();
                /* v2：写入时补首尾静音（修复首词吞音），缓存键跟着升级，旧 WAV 自然失效 */
                String key = sha1(text + "|" + v + "|piper-v4");
                File out = new File(dir, key + ".wav");
                int sampleRate = t.sampleRate();
                if (!out.exists() || out.length() < 100) {
                    GeneratedAudio audio = t.generate(text, 0, 1.0f);
                    if (audio == null) throw new RuntimeException("generate returned null");
                    sampleRate = audio.getSampleRate();
                    /* 【首词吞音修复】Piper 输出几乎从第一个采样就开口，而 MediaPlayer 起播
                     * 需要几毫秒准备；没有前导静音时首音会被切掉。写 WAV 时补 150ms 前导
                     * + 100ms 尾部静音：首词保住，句尾也不会显得被切断。*/
                    saveWavWithPadding(out, audio.getSamples(), sampleRate, 0.35f, 0.15f);
                }
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("path", out.getAbsolutePath());
                r.put("sampleRate", sampleRate);
                r.put("voice", v);
                call.resolve(r);
            } catch (Throwable e) {
                call.reject("local tts synthesize failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ready", !models.isEmpty());
        r.put("loading", loading);
        r.put("loaded", models.keySet().toArray(new String[0]));
        call.resolve(r);
    }

    @Override
    protected void handleOnDestroy() {
        for (OfflineTts t : models.values()) {
            try { t.release(); } catch (Throwable ignored) {}
        }
        models.clear();
        pool.shutdownNow();
        super.handleOnDestroy();
    }
}