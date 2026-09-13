package com.bytebite.freshwise;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Size;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableNativeMap;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;

public class FreshWiseImagePickerModule extends ReactContextBaseJavaModule {
  private static final int REQUEST_PICK_IMAGE = 42073;

  private final ReactApplicationContext reactContext;
  private Promise pendingPromise;

  private final ActivityEventListener activityEventListener = new BaseActivityEventListener() {
    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
      if (requestCode != REQUEST_PICK_IMAGE) {
        return;
      }
      Promise promise = pendingPromise;
      pendingPromise = null;
      if (promise == null) {
        return;
      }
      if (resultCode != Activity.RESULT_OK) {
        promise.resolve(null);
        return;
      }
      Uri sourceUri = data == null ? null : data.getData();
      if (sourceUri == null) {
        promise.reject("NO_IMAGE", "No image was selected.");
        return;
      }
      try {
        File copied = copyUriToCache(sourceUri);
        promise.resolve(resultForFile(copied));
      } catch (Exception error) {
        promise.reject("IMAGE_PICK_FAILED", error.getMessage(), error);
      }
    }
  };

  public FreshWiseImagePickerModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
    reactContext.addActivityEventListener(activityEventListener);
  }

  @Override
  public String getName() {
    return "FreshWiseImagePicker";
  }

  @ReactMethod
  public void pickImage(Promise promise) {
    Activity activity = getCurrentActivity();
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "The Android activity is not ready.");
      return;
    }
    if (pendingPromise != null) {
      promise.reject("PICKER_BUSY", "Another image picker is already open.");
      return;
    }
    pendingPromise = promise;
    try {
      Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
      intent.addCategory(Intent.CATEGORY_OPENABLE);
      intent.setType("image/*");
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
      activity.startActivityForResult(intent, REQUEST_PICK_IMAGE);
    } catch (Exception error) {
      pendingPromise = null;
      promise.reject("PICKER_OPEN_FAILED", error.getMessage(), error);
    }
  }

  @ReactMethod
  public void copyImage(String imageUri, Promise promise) {
    try {
      if (imageUri == null || imageUri.trim().isEmpty()) {
        promise.reject("NO_IMAGE_URI", "No image URI was provided.");
        return;
      }
      File copied = copyUriToCache(Uri.parse(imageUri));
      promise.resolve(resultForFile(copied));
    } catch (Exception error) {
      promise.reject("IMAGE_COPY_FAILED", error.getMessage(), error);
    }
  }

  @ReactMethod
  public void readImageBase64(String imageUri, Promise promise) {
    try {
      if (imageUri == null || imageUri.trim().isEmpty()) {
        promise.reject("NO_IMAGE_URI", "No image URI was provided.");
        return;
      }
      Uri uri = Uri.parse(imageUri);
      byte[] bytes = readUriBytes(uri);
      promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP));
    } catch (Exception error) {
      promise.reject("IMAGE_READ_FAILED", error.getMessage(), error);
    }
  }

  private WritableNativeMap resultForFile(File file) {
    BitmapFactory.Options options = new BitmapFactory.Options();
    options.inJustDecodeBounds = true;
    BitmapFactory.decodeFile(file.getAbsolutePath(), options);

    WritableNativeMap result = new WritableNativeMap();
    result.putString("uri", Uri.fromFile(file).toString());
    result.putString("name", file.getName());
    result.putString("type", mimeTypeFor(file.getName()));
    if (options.outWidth > 0) {
      result.putInt("width", options.outWidth);
    }
    if (options.outHeight > 0) {
      result.putInt("height", options.outHeight);
    }
    return result;
  }

  private File copyUriToCache(Uri sourceUri) throws Exception {
    File outFile = new File(
      reactContext.getCacheDir(),
      "freshwise-picked-" + System.currentTimeMillis() + ".jpg"
    );

    Bitmap bitmap = decodePreviewBitmap(sourceUri);
    if (bitmap == null) {
      throw new IllegalStateException("Could not decode the selected image for preview.");
    }
    try (FileOutputStream output = new FileOutputStream(outFile)) {
      if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 92, output)) {
        throw new IllegalStateException("Could not create a compatible JPEG preview.");
      }
    } finally {
      if (!bitmap.isRecycled()) {
        bitmap.recycle();
      }
    }
    return outFile;
  }

  private Bitmap decodePreviewBitmap(Uri sourceUri) throws Exception {
    BitmapFactory.Options bounds = new BitmapFactory.Options();
    bounds.inJustDecodeBounds = true;
    try (InputStream input = openInputStream(sourceUri)) {
      if (input == null) {
        throw new IllegalStateException("Could not read the selected image.");
      }
      BitmapFactory.decodeStream(input, null, bounds);
    }

    if (bounds.outWidth > 0 && bounds.outHeight > 0) {
      BitmapFactory.Options options = new BitmapFactory.Options();
      options.inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight, 2200);
      options.inPreferredConfig = Bitmap.Config.ARGB_8888;
      try (InputStream input = openInputStream(sourceUri)) {
        if (input == null) {
          throw new IllegalStateException("Could not read the selected image.");
        }
        Bitmap bitmap = BitmapFactory.decodeStream(input, null, options);
        if (bitmap != null) {
          return bitmap;
        }
      }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        ImageDecoder.Source source = "file".equalsIgnoreCase(sourceUri.getScheme())
          ? ImageDecoder.createSource(new File(sourceUri.getPath()))
          : ImageDecoder.createSource(reactContext.getContentResolver(), sourceUri);
        return ImageDecoder.decodeBitmap(source, (decoder, info, src) -> {
          decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
          Size size = info.getSize();
          int width = size.getWidth();
          int height = size.getHeight();
          int longest = Math.max(width, height);
          if (longest > 2200) {
            float scale = 2200f / (float) longest;
            decoder.setTargetSize(
              Math.max(1, Math.round(width * scale)),
              Math.max(1, Math.round(height * scale))
            );
          }
        });
      } catch (Exception ignored) {
        return null;
      }
    }
    return null;
  }

  private int sampleSizeFor(int width, int height, int maxDimension) {
    int sampleSize = 1;
    int longest = Math.max(width, height);
    while (longest / sampleSize > maxDimension) {
      sampleSize *= 2;
    }
    return Math.max(1, sampleSize);
  }

  private byte[] readUriBytes(Uri sourceUri) throws Exception {
    long maximumBytes = 20L * 1024L * 1024L;
    try (InputStream input = openInputStream(sourceUri);
         java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
      if (input == null) {
        throw new IllegalStateException("Could not read the selected image.");
      }
      byte[] buffer = new byte[8192];
      int read;
      long total = 0L;
      while ((read = input.read(buffer)) != -1) {
        total += read;
        if (total > maximumBytes) {
          throw new IllegalStateException("Selected image is too large.");
        }
        output.write(buffer, 0, read);
      }
      return output.toByteArray();
    }
  }

  private InputStream openInputStream(Uri sourceUri) throws Exception {
    String scheme = sourceUri.getScheme();
    if ("file".equalsIgnoreCase(scheme)) {
      return new FileInputStream(new File(sourceUri.getPath()));
    }
    return reactContext.getContentResolver().openInputStream(sourceUri);
  }

  private String mimeTypeFor(String fileName) {
    String lower = fileName == null ? "" : fileName.toLowerCase();
    if (lower.endsWith(".png")) {
      return "image/png";
    }
    if (lower.endsWith(".webp")) {
      return "image/webp";
    }
    return "image/jpeg";
  }

  private String displayNameFor(Uri uri) {
    try (Cursor cursor = reactContext.getContentResolver().query(uri, null, null, null, null)) {
      if (cursor == null) {
        return null;
      }
      int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
      if (index >= 0 && cursor.moveToFirst()) {
        return cursor.getString(index);
      }
      return null;
    }
  }
}
