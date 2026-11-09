// Copyright (c) 2026 KLOWZY. SPDX-License-Identifier: MIT
// Original implementation of the documented NSIS Unicode plugin ABI and Windows COM APIs.
// No WinShell code or binary is used. This DLL is an installer component, never renderer IPC.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shobjidl.h>
#include <shlobj.h>
#include <initguid.h>
#include <propkey.h>

// NSIS owns a linked stack of GlobalAlloc blocks. Pop detaches one argument;
// its text remains owned here until the call finishes. No CRT is linked.
struct Stack { Stack* next; wchar_t text[1]; };
struct Argument {
  Stack* entry = nullptr;
  bool valid = false;
  Argument(Stack** top, int length) {
    if (!top || !*top || length < 1 || length > 32768) return;
    entry = *top;
    *top = entry->next;
    for (int i = 0; i < length; ++i) {
      if (!entry->text[i]) { valid = i > 0; break; }
    }
  }
  ~Argument() { if (entry) GlobalFree(entry); }
  const wchar_t* text() const { return valid ? entry->text : L""; }
};
template<class T> struct ComPtr {
  T* value = nullptr;
  ~ComPtr() { if (value) value->Release(); }
};
struct Apartment {
  HRESULT result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  ~Apartment() { if (SUCCEEDED(result)) CoUninitialize(); }
  bool usable() const { return SUCCEEDED(result) || result == RPC_E_CHANGED_MODE; }
};
static void reply(Stack** top, HRESULT result) {
  if (!top) return;
  auto* item = static_cast<Stack*>(GlobalAlloc(GPTR, sizeof(Stack) + 32 * sizeof(wchar_t)));
  if (!item) return;
  wsprintfW(item->text, L"%ld", result); // Fixed format; 32 chars exceed a signed 32-bit result.
  item->next = *top;
  *top = item;
}
static HRESULT setIdentity(const wchar_t* file, const wchar_t* id) {
  ComPtr<IShellLinkW> link;
  HRESULT hr = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
                               IID_PPV_ARGS(&link.value));
  if (FAILED(hr)) return hr;
  ComPtr<IPersistFile> persist;
  hr = link.value->QueryInterface(IID_PPV_ARGS(&persist.value));
  if (FAILED(hr)) return hr;
  hr = persist.value->Load(file, STGM_READWRITE);
  if (FAILED(hr)) return hr;
  ComPtr<IPropertyStore> store;
  hr = link.value->QueryInterface(IID_PPV_ARGS(&store.value));
  if (FAILED(hr)) return hr;
  PROPVARIANT value = {};
  value.vt = VT_LPWSTR;
  value.pwszVal = const_cast<wchar_t*>(id); // Borrowed for SetValue; not owned by this variant.
  hr = store.value->SetValue(PKEY_AppUserModel_ID, value);
  if (SUCCEEDED(hr)) hr = store.value->Commit();
  if (SUCCEEDED(hr)) hr = persist.value->Save(file, TRUE);
  return hr;
}
extern "C" void __cdecl SetLnkAUMI(HWND, int length, wchar_t*, Stack** stack, void*) {
  Argument file(stack, length), id(stack, length);
  Apartment apartment;
  reply(stack, !file.valid || !id.valid ? E_INVALIDARG :
    apartment.usable() ? setIdentity(file.text(), id.text()) : apartment.result);
}
extern "C" void __cdecl UninstAppUserModelId(HWND, int length, wchar_t*, Stack** stack, void*) {
  Argument id(stack, length);
  Apartment apartment;
  HRESULT hr = E_INVALIDARG;
  if (id.valid && apartment.usable()) {
    ComPtr<IApplicationDestinations> destinations;
    hr = CoCreateInstance(CLSID_ApplicationDestinations, nullptr, CLSCTX_INPROC_SERVER,
                          IID_PPV_ARGS(&destinations.value));
    if (SUCCEEDED(hr)) hr = destinations.value->SetAppID(id.text());
    if (SUCCEEDED(hr)) hr = destinations.value->RemoveAllDestinations();
    ComPtr<ICustomDestinationList> list;
    HRESULT other = CoCreateInstance(CLSID_DestinationList, nullptr, CLSCTX_INPROC_SERVER,
                                     IID_PPV_ARGS(&list.value));
    if (SUCCEEDED(other)) other = list.value->DeleteList(id.text());
    if (SUCCEEDED(hr)) hr = other;
  }
  reply(stack, hr);
}
extern "C" void __cdecl UninstShortcut(HWND, int length, wchar_t*, Stack** stack, void*) {
  Argument file(stack, length);
  Apartment apartment;
  HRESULT hr = E_INVALIDARG;
  if (file.valid && apartment.usable()) {
    ComPtr<IShellItem> item;
    hr = SHCreateItemFromParsingName(file.text(), nullptr, IID_PPV_ARGS(&item.value));
    if (SUCCEEDED(hr)) {
      ComPtr<IStartMenuPinnedList> list;
      hr = CoCreateInstance(CLSID_StartMenuPin, nullptr, CLSCTX_INPROC_SERVER,
                            IID_PPV_ARGS(&list.value));
      if (SUCCEEDED(hr)) hr = list.value->RemoveFromList(item.value);
    }
  }
  reply(stack, hr);
}
extern "C" BOOL WINAPI DllMain(HINSTANCE, DWORD, LPVOID) { return TRUE; }
