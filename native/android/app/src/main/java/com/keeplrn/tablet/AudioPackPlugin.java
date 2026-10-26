package com.keeplrn.tablet;

import android.content.res.AssetFileDescriptor;
import android.media.MediaPlayer;
import android.media.PlaybackParams;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 预生成音频包播放器：读 APK assets/public/audio 下的音频，支持语速。 */
@CapacitorPlugin(name = "AudioPack")
public class AudioPackPlugin extends Plugin {
    private MediaPlayer player;

    private void releasePlayer() {
        if (player != null) {
            try { player.stop(); } catch (Throwable ignored) {}
            try { player.release(); } catch (Throwable ignored) {}
            player = null;
        }
    }

    private void emit(String type, String id, String error) {
        JSObject d = new JSObject();
        d.put("type", type);
        d.put("id", id);
        if (error != null) d.put("error", error);
        notifyListeners("audioEvent", d);
    }

    @PluginMethod
    public void play(PluginCall call) {
        String path = call.getString("path", "");
        String filePath = call.getString("filePath", "");
        String id = call.getString("id", "0");
        float speed = call.getFloat("speed", 1.0f);
        if ((path == null || path.isEmpty()) && (filePath == null || filePath.isEmpty())) {
            call.reject("missing path"); return;
        }
        releasePlayer();
        try {
            player = new MediaPlayer();
            if (filePath != null && !filePath.isEmpty()) {
                player.setDataSource(filePath);
            } else {
                AssetFileDescriptor afd = getContext().getAssets().openFd("public/assets/" + path);
                player.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                afd.close();
            }
            /* 【吞音修复 2026-10-22】setPlaybackParams 在 start 之前调用时，
             * 部分机型（本机 TB321FU 实测）会丢掉开头几十~上百毫秒——听感就是
             * “每句首词被吞”。1.0 倍速（绝大多数场景）根本不需要设置参数，直接 start；
             * 只有变速/变调时才在 start 之后再设置，避开起播阶段。*/
            player.setOnPreparedListener(mp -> {
                mp.start();
                emit("start", id, null);
                if (Math.abs(speed - 1.0f) > 0.01f) {
                    try {
                        PlaybackParams pp = new PlaybackParams();
                        pp.setSpeed(Math.max(0.5f, Math.min(2.0f, speed)));
                        mp.setPlaybackParams(pp);
                    } catch (Throwable ignored) {}
                }
            });
            player.setOnCompletionListener(mp -> {
                emit("end", id, null);
                releasePlayer();
            });
            player.setOnErrorListener((mp, what, extra) -> {
                emit("error", id, "MediaPlayer error " + what + "/" + extra);
                releasePlayer();
                return true;
            });
            player.prepareAsync();
            call.resolve(new JSObject().put("ok", true));
        } catch (Throwable e) {
            releasePlayer();
            call.reject("play failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        releasePlayer();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        releasePlayer();
        super.handleOnDestroy();
    }
}