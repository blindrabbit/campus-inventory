"use client";
import { useEffect } from "react";
import axios from "axios";

let interceptorRegistered = false;

export default function AxiosAuthGuard() {
  useEffect(() => {
    if (interceptorRegistered) return;
    interceptorRegistered = true;

    const id = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error?.response?.status === 401) {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          localStorage.removeItem("activeInventoryId");
          localStorage.removeItem("activeInventory");
          window.location.href = "/login";
        }
        return Promise.reject(error);
      },
    );

    return () => {
      axios.interceptors.response.eject(id);
      interceptorRegistered = false;
    };
  }, []);

  return null;
}
