import { NativeModules, Platform } from 'react-native';

type PickedImage = {
  uri: string;
  width?: number;
  height?: number;
  name?: string;
  type?: string;
};

type FreshWiseImagePickerModule = {
  pickImage: () => Promise<PickedImage | null>;
  copyImage?: (imageUri: string) => Promise<PickedImage>;
  readImageBase64?: (imageUri: string) => Promise<string>;
};

const nativePicker = NativeModules.FreshWiseImagePicker as FreshWiseImagePickerModule | undefined;

export async function pickImageFromDeviceFiles(): Promise<PickedImage | null> {
  if (Platform.OS !== 'android' || !nativePicker?.pickImage) {
    throw new Error('The Android image file picker is not available in this build.');
  }
  return nativePicker.pickImage();
}

export async function copyImageToAppCache(imageUri: string): Promise<PickedImage> {
  if (Platform.OS === 'android' && nativePicker?.copyImage) {
    return nativePicker.copyImage(imageUri);
  }
  return { uri: imageUri };
}

export async function readImageBase64(imageUri: string): Promise<string> {
  if (Platform.OS !== 'android' || !nativePicker?.readImageBase64) {
    throw new Error('The Android image reader is not available in this build.');
  }
  return nativePicker.readImageBase64(imageUri);
}

export function hasNativeImageBase64Reader(): boolean {
  return Platform.OS === 'android' && typeof nativePicker?.readImageBase64 === 'function';
}

export function hasNativeImageFilePicker(): boolean {
  return Platform.OS === 'android' && typeof nativePicker?.pickImage === 'function';
}
