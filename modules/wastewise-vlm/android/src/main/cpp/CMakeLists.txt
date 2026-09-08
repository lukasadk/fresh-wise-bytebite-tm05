cmake_minimum_required(VERSION 3.22.1)

project(wastewise_vlm LANGUAGES CXX)

add_library(MNN SHARED IMPORTED)
set_target_properties(MNN PROPERTIES
  IMPORTED_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libMNN.so"
)

add_library(wastewise_vlm SHARED wastewise_vlm_jni.cpp)

target_include_directories(wastewise_vlm PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/vendor/mnn/include"
)

find_library(android-lib android)
find_library(jnigraphics-lib jnigraphics)
find_library(log-lib log)

target_link_libraries(wastewise_vlm
  MNN
  ${android-lib}
  ${jnigraphics-lib}
  ${log-lib}
)

target_compile_features(wastewise_vlm PRIVATE cxx_std_17)
target_compile_options(wastewise_vlm PRIVATE -Wall -Wextra -Werror=return-type)
