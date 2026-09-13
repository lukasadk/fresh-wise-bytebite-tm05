package com.bytebite.freshwise;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.net.Uri;
import android.graphics.Paint;
import android.graphics.Rect;
import android.util.Base64;
import android.util.Log;
import android.view.View;

import com.facebook.react.uimanager.SimpleViewManager;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.annotations.ReactProp;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class FreshWisePreviewImageViewManager extends SimpleViewManager<FreshWisePreviewImageViewManager.PreviewImageView> {
  public static final String REACT_CLASS = "FreshWisePreviewImageView";
  private static final String TAG = "FreshWisePreviewImage";
  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  @Override
  public String getName() {
    return REACT_CLASS;
  }

  @Override
  protected PreviewImageView createViewInstance(ThemedReactContext reactContext) {
    return new PreviewImageView(reactContext);
  }

  @ReactProp(name = "sourceUri")
  public void setSourceUri(PreviewImageView view, String sourceUri) {
    Log.d(TAG, "setSourceUri " + (sourceUri == null ? "null" : sourceUri.substring(0, Math.min(sourceUri.length(), 80))));
    view.setTag(sourceUri);
    view.setBitmap(null);
    if (sourceUri == null || sourceUri.trim().isEmpty()) {
      return;
    }

    executor.execute(() -> {
      Bitmap bitmap = null;
      try {
        bitmap = decodeBitmap(view.getContext(), sourceUri);
        if (bitmap != null) {
          Log.d(TAG, "decoded preview " + bitmap.getWidth() + "x" + bitmap.getHeight());
        } else {
          Log.e(TAG, "decode returned null");
        }
      } catch (Exception error) {
        Log.e(TAG, "Could not decode preview image: " + sourceUri, error);
      }
      Bitmap finalBitmap = bitmap;
      view.post(() -> {
        Object current = view.getTag();
        if (current instanceof String && current.equals(sourceUri)) {
          view.setBitmap(finalBitmap);
        } else if (finalBitmap != null && !finalBitmap.isRecycled()) {
          finalBitmap.recycle();
        }
      });
    });
  }

  private Bitmap decodeBitmap(Context context, String sourceUri) throws Exception {
    if (sourceUri.startsWith("data:")) {
      int commaIndex = sourceUri.indexOf(',');
      if (commaIndex < 0) {
        throw new IllegalArgumentException("Invalid data URI.");
      }
      byte[] bytes = Base64.decode(sourceUri.substring(commaIndex + 1), Base64.DEFAULT);
      return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    }

    Uri uri = Uri.parse(sourceUri);
    String scheme = uri.getScheme();
    if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
      HttpURLConnection connection = (HttpURLConnection) new URL(sourceUri).openConnection();
      connection.setConnectTimeout(15000);
      connection.setReadTimeout(30000);
      connection.setInstanceFollowRedirects(true);
      try (InputStream input = connection.getInputStream()) {
        return BitmapFactory.decodeStream(input);
      } finally {
        connection.disconnect();
      }
    }

    try (InputStream input = context.getContentResolver().openInputStream(uri)) {
      return BitmapFactory.decodeStream(input);
    }
  }

  public static class PreviewImageView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG);
    private final Rect destination = new Rect();
    private Bitmap bitmap;

    public PreviewImageView(Context context) {
      super(context);
      setWillNotDraw(false);
      setLayerType(View.LAYER_TYPE_SOFTWARE, null);
    }

    public void setBitmap(Bitmap nextBitmap) {
      Bitmap previous = bitmap;
      bitmap = nextBitmap;
      if (nextBitmap != null) {
        Log.d(TAG, "setBitmap " + nextBitmap.getWidth() + "x" + nextBitmap.getHeight()
          + " view=" + getWidth() + "x" + getHeight());
      } else {
        Log.d(TAG, "clear bitmap view=" + getWidth() + "x" + getHeight());
      }
      if (previous != null && previous != nextBitmap && !previous.isRecycled()) {
        previous.recycle();
      }
      invalidate();
    }

    @Override
    protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
      super.onSizeChanged(width, height, oldWidth, oldHeight);
      Log.d(TAG, "onSizeChanged " + width + "x" + height + " old=" + oldWidth + "x" + oldHeight);
    }

    @Override
    protected void onDraw(Canvas canvas) {
      super.onDraw(canvas);
      if (bitmap == null || bitmap.isRecycled()) {
        Log.d(TAG, "onDraw no bitmap view=" + getWidth() + "x" + getHeight());
        return;
      }
      int width = getWidth();
      int height = getHeight();
      if (width <= 0 || height <= 0) {
        Log.d(TAG, "onDraw skipped zero size");
        return;
      }
      destination.set(0, 0, width, height);
      canvas.drawBitmap(bitmap, null, destination, paint);
      Log.d(TAG, "onDraw bitmap drawn view=" + width + "x" + height);
    }
  }
}
