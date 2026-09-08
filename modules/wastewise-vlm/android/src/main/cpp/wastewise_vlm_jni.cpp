#include <jni.h>
#include <android/bitmap.h>
#include <android/log.h>

#include <llm/llm.hpp>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <sstream>
#include <string>

namespace {

constexpr const char* kLogTag = "WasteWiseVlm";

using MNN::Express::NHWC;
using MNN::Express::_Input;
using MNN::Transformer::Llm;
using MNN::Transformer::LlmStatus;
using MNN::Transformer::MultimodalPrompt;
using MNN::Transformer::PromptImagePart;

void throwJava(JNIEnv* env, const char* className, const std::string& message) {
  jclass exceptionClass = env->FindClass(className);
  if (exceptionClass != nullptr) {
    env->ThrowNew(exceptionClass, message.c_str());
  }
}

std::string fromJString(JNIEnv* env, jstring value) {
  if (value == nullptr) return {};
  const char* chars = env->GetStringUTFChars(value, nullptr);
  if (chars == nullptr) return {};
  std::string result(chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}

jobjectArray toJavaStringArray(JNIEnv* env, const std::string values[], size_t count) {
  jclass stringClass = env->FindClass("java/lang/String");
  if (stringClass == nullptr) return nullptr;
  jobjectArray result = env->NewObjectArray(static_cast<jsize>(count), stringClass, nullptr);
  if (result == nullptr) return nullptr;
  for (size_t index = 0; index < count; ++index) {
    jstring value = env->NewStringUTF(values[index].c_str());
    if (value == nullptr) return nullptr;
    env->SetObjectArrayElement(result, static_cast<jsize>(index), value);
    env->DeleteLocalRef(value);
  }
  return result;
}

Llm* getLlm(JNIEnv* env, jlong handle) {
  auto* llm = reinterpret_cast<Llm*>(static_cast<uintptr_t>(handle));
  if (llm == nullptr) {
    throwJava(env, "java/lang/IllegalStateException", "The offline model has not been loaded.");
  }
  return llm;
}

}  // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_expo_modules_wastewisevlm_WasteWiseMnnBridge_nativeCreate(
    JNIEnv* env, jclass, jstring configPath) {
  const std::string path = fromJString(env, configPath);
  if (path.empty()) {
    throwJava(env, "java/lang/IllegalArgumentException", "The MNN config path is empty.");
    return 0;
  }

  Llm* llm = Llm::createLLM(path);
  if (llm == nullptr) {
    throwJava(env, "java/lang/IllegalStateException", "MNN could not create the offline VLM.");
    return 0;
  }
  if (!llm->load()) {
    const std::string log = llm->getLog();
    Llm::destroy(llm);
    throwJava(env, "java/lang/IllegalStateException", "MNN model loading failed. " + log);
    return 0;
  }
  // Re-apply deterministic generation settings after the sampler is created.
  llm->set_config(
      R"({"max_new_tokens":512,"sampler_type":"mixed","mixed_samplers":["penalty","topK","topP","temperature"],"temperature":0.2,"top_k":20,"top_p":0.9,"repetition_penalty":1.08,"penalty_window":128,"n_gram":4,"ngram_factor":1.2})");
  __android_log_print(ANDROID_LOG_INFO, kLogTag, "MNN model loaded from %s", path.c_str());
  return static_cast<jlong>(reinterpret_cast<uintptr_t>(llm));
}

extern "C" JNIEXPORT jobjectArray JNICALL
Java_expo_modules_wastewisevlm_WasteWiseMnnBridge_nativeAnalyze(
    JNIEnv* env,
    jclass,
    jlong handle,
    jobject bitmap,
    jstring prompt,
    jint maxNewTokens) {
  Llm* llm = getLlm(env, handle);
  if (llm == nullptr || env->ExceptionCheck()) return nullptr;
  if (bitmap == nullptr) {
    throwJava(env, "java/lang/IllegalArgumentException", "The decoded image is null.");
    return nullptr;
  }

  AndroidBitmapInfo bitmapInfo{};
  if (AndroidBitmap_getInfo(env, bitmap, &bitmapInfo) != ANDROID_BITMAP_RESULT_SUCCESS) {
    throwJava(env, "java/lang/IllegalArgumentException", "Android could not inspect the image bitmap.");
    return nullptr;
  }
  if (bitmapInfo.format != ANDROID_BITMAP_FORMAT_RGBA_8888 || bitmapInfo.width == 0 || bitmapInfo.height == 0) {
    throwJava(env, "java/lang/IllegalArgumentException", "The native VLM requires a non-empty ARGB_8888 bitmap.");
    return nullptr;
  }

  void* rawPixels = nullptr;
  if (AndroidBitmap_lockPixels(env, bitmap, &rawPixels) != ANDROID_BITMAP_RESULT_SUCCESS || rawPixels == nullptr) {
    throwJava(env, "java/lang/IllegalStateException", "Android could not lock the image pixels.");
    return nullptr;
  }

  const int width = static_cast<int>(bitmapInfo.width);
  const int height = static_cast<int>(bitmapInfo.height);
  auto image = _Input({height, width, 3}, NHWC, halide_type_of<uint8_t>());
  uint8_t* destination = image->writeMap<uint8_t>();
  const auto* source = static_cast<const uint8_t*>(rawPixels);
  for (int y = 0; y < height; ++y) {
    const uint8_t* row = source + static_cast<size_t>(y) * bitmapInfo.stride;
    for (int x = 0; x < width; ++x) {
      const uint8_t* rgba = row + static_cast<size_t>(x) * 4;
      uint8_t* bgr = destination + (static_cast<size_t>(y) * width + x) * 3;
      // MNN CV image inputs use BGR uint8, matching MNN.cv.imread.
      bgr[0] = rgba[2];
      bgr[1] = rgba[1];
      bgr[2] = rgba[0];
    }
  }
  AndroidBitmap_unlockPixels(env, bitmap);

  std::string promptText = fromJString(env, prompt);
  if (promptText.find("<img>") == std::string::npos) {
    promptText = "<img>image_0</img>\n" + promptText;
  }

  MultimodalPrompt multimodalPrompt;
  multimodalPrompt.prompt_template = promptText;
  multimodalPrompt.images.emplace("image_0", PromptImagePart{image, width, height});

  const int tokenLimit = std::clamp(static_cast<int>(maxNewTokens), 32, 1024);
  llm->reset();
  std::ostringstream output;
  const auto started = std::chrono::steady_clock::now();
  llm->response(multimodalPrompt, &output, nullptr, tokenLimit);
  const auto finished = std::chrono::steady_clock::now();
  const auto totalMs = std::chrono::duration_cast<std::chrono::milliseconds>(finished - started).count();
  const auto* context = llm->getContext();
  if (context == nullptr ||
      (context->status != LlmStatus::NORMAL_FINISHED &&
       context->status != LlmStatus::MAX_TOKENS_FINISHED)) {
    throwJava(env, "java/lang/IllegalStateException", "MNN inference failed. " + llm->getLog());
    return nullptr;
  }

  const std::string rawText = output.str();
  if (rawText.empty()) {
    throwJava(env, "java/lang/IllegalStateException", "MNN returned an empty result. " + llm->getLog());
    return nullptr;
  }

  const std::string values[] = {
      rawText,
      std::to_string(totalMs),
      std::to_string(context->vision_us / 1000),
      std::to_string(context->prefill_us / 1000),
      std::to_string(context->decode_us / 1000),
      std::to_string(context->prompt_len),
      std::to_string(context->gen_seq_len),
      std::to_string(static_cast<int>(context->status)),
      llm->getLog(),
  };
  return toJavaStringArray(env, values, sizeof(values) / sizeof(values[0]));
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_wastewisevlm_WasteWiseMnnBridge_nativeDestroy(
    JNIEnv*, jclass, jlong handle) {
  auto* llm = reinterpret_cast<Llm*>(static_cast<uintptr_t>(handle));
  if (llm != nullptr) {
    Llm::destroy(llm);
  }
}
