package com.keeplrn.tablet;

import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.Set;

/** 最小原生 TTS 插件：给 WebView 的 speechSynthesis 兼容层提供 list/speak/stop。 */
@CapacitorPlugin(name = "Tts")
public class TtsPlugin extends Plugin {
    private TextToSpeech tts;
    private boolean ready = false;

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), status -> {
            ready = status == TextToSpeech.SUCCESS;
            if (ready) {
                try { tts.setLanguage(Locale.US); } catch (Exception ignored) {}
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String utteranceId) { emit("start", utteranceId, null); }
                    @Override public void onDone(String utteranceId) { emit("end", utteranceId, null); }
                    @Override public void onError(String utteranceId) { emit("error", utteranceId, "tts error"); }
                });
            }
        });
    }

    private void emit(String type, String id, String error) {
        JSObject data = new JSObject();
        data.put("type", type);
        data.put("id", id);
        if (error != null) data.put("error", error);
        notifyListeners("ttsEvent", data);
    }

    @PluginMethod
    public void getVoices(PluginCall call) {
        JSArray arr = new JSArray();
        if (tts != null && ready) {
            try {
                Set<Voice> list = tts.getVoices();
                if (list != null) {
                    for (Voice v : list) {
                        if (v == null) continue;
                        JSObject item = new JSObject();
                        String name = v.getName();
                        item.put("name", name);
                        item.put("voiceURI", name);
                        item.put("lang", v.getLocale() != null ? v.getLocale().toLanguageTag() : "en-US");
                        item.put("local", !v.isNetworkConnectionRequired());
                        arr.put(item);
                    }
                }
            } catch (Exception e) {
                call.reject("getVoices failed: " + e.getMessage());
                return;
            }
        }
        JSObject out = new JSObject();
        out.put("voices", arr);
        call.resolve(out);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        if (tts == null || !ready) { call.reject("TTS not ready"); return; }
        String text = call.getString("text", "");
        if (text == null || text.isEmpty()) { call.reject("empty text"); return; }
        String id = call.getString("id", String.valueOf(System.currentTimeMillis()));
        float rate = call.getFloat("rate", 1.0f);
        float pitch = call.getFloat("pitch", 1.0f);
        String voiceName = call.getString("voice", "");
        String lang = call.getString("lang", "en-US");

        try {
            if (lang != null && !lang.isEmpty()) {
                Locale locale = Locale.forLanguageTag(lang);
                if (tts.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) tts.setLanguage(locale);
            }
            if (voiceName != null && !voiceName.isEmpty()) {
                for (Voice v : tts.getVoices()) {
                    if (v != null && (voiceName.equals(v.getName()) || voiceName.equals(v.getLocale().toLanguageTag()))) {
                        tts.setVoice(v);
                        break;
                    }
                }
            }
            tts.setSpeechRate(rate);
            tts.setPitch(pitch);
            int result = tts.speak(text, TextToSpeech.QUEUE_ADD, null, id);
            if (result == TextToSpeech.ERROR) { call.reject("speak failed"); return; }
        } catch (Exception e) {
            call.reject("speak failed: " + e.getMessage());
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); }
        super.handleOnDestroy();
    }
}
